# Agents v2 → v3: the 3-day fast track

13 Nov 2026. Read with `CONTEXT.md` and `v2-chunks.md`. For these three days this file sets the order and the cuts. `v2-chunks.md` still describes each chunk and keeps the Progress table, and a chunk's own brief still wins for that chunk.

**The plan in one line:** in three days, make the assistant public, let it act on the owner's own lists, remember people, ask the owner before risky actions, and send its first reminders. Everything else in v2 and v3 is kept, ordered and parked below.

Assumes CL1 is merged and v2.0 is live. Any unticked line in `LAUNCH-CHECKLIST.md` is the first hour of Day 1.

## Status: checked on master, 13 Nov 14:30

- **Slice 1 is merged into master,** and the working tree was clean.
- **Production is probably still answering with v1.** `0fb34139c` (today) makes `AGENT_RUNTIME__ENABLED` default to true, because production never set it and every message fell back to v1. That commit is after the last release bump (2.0.9, this morning) and in no release tag. Until it ships, or the variable is set in production, the v2 agent isn't what people get. **Release it first,** then watch the v1 fallback rate and reply times for a few hours.
- **H0: not started.** `phone_e164` is still `varchar(32)`; there's no warm-up; ally-be still doesn't send `ally_ai_builder_change` (not in `BUILDER_PROMPT_CODES`) or `ally_ai_checkup_questions` (`CHECKUP_PROMPT_CODES` holds only the judge); `onboarding_eval.py` is unchanged since 10 Nov; `LAUNCH-CHECKLIST.md` has 0 of 19 lines ticked. One item changed: since `0fb34139c`, runs aren't stored at all without `AGENT_RUNTIME__CHECKPOINT_DB_URL`, so checkpoint retention matters only if production sets it.
- **15a: not started.** The crisis check still receives only the latest message (`CrisisCheckRequest` has `message` and `prompts`), `crisis_classify.txt` hasn't changed since 4 Nov, and `botPagePublicAllowed` still defaults to off. **A head start exists:** today's conversation basics suite (`8bdbbf53b`, `npm run chatbot:basics` in ally-be) already runs urgent-risk and support-level distress cases in English, Hindi and Hinglish, a two-turn continuation and Trijog's two transcripts through the real engine, with must-pass rules (urgent stays urgent; complaints, typos and greetings never get the crisis reply). 15a's eval extends that suite rather than starting a new one.
- **Briefs written (13 Nov, 15:00):** `chunk-h0.md` and `chunk-15a.md`, in the repo's `docs/agents-v2/` (not committed yet) and in this project. Both sessions work on `feat/agents-v2-fast-track`, in the same folder.

## 1. Where we are

**Live (v2.0, the POC):** website → tested, branded assistant → link. The agent answers in its own voice with sources, safety packs and purposes. Bot page, website bubble and WhatsApp. Checkup, scorecard and thumbs. A light inbox with take over and hand back. Change by chat, How it works and History.

**What it can't do yet, which is what owners ask for first:**
- **Talk to the public.** Public links are off until the crisis classifier v2 (15a, gate G1b). The page and the bubble work only for an organisation or invited emails, so a clinic can't put it on its website for patients.
- **Do anything.** It answers. It can't book, put an enquiry into a list, or change a record. There is no tool beyond `search_knowledge`, and no gateway (3b).
- **Remember anyone.** No profiles or memory.
- **Reach out.** No follow-ups. WhatsApp sends plain text only, inside 24 hours (no template messages).

**Carried-over items that bite once real traffic arrives:**

| Item | From | Why now |
|---|---|---|
| Erasure writes `erased:<uuid>` (43 characters) into `wa_contacts.phone_e164`, which is `varchar(32)` | CHUNK-12-NOTES §7 | In production, retention never erases phone numbers and "Erase contact" returns 500. Forget and export build on this |
| Checkpoints are kept forever, when a checkpoint database is set | CHUNK-01-NOTES §7; `0fb34139c` | Public traffic multiplies checkpoint rows. Without `AGENT_RUNTIME__CHECKPOINT_DB_URL`, nothing is stored |
| No warm-up when ally-ai starts | `v2-chunks.md`, Learned so far; CHUNK-03C-NOTES §9 | The first question after a deploy can hit the 20 s cap and fall back to v1 |
| ally-be doesn't send Skills Store overrides for `ally_ai_builder_change` and `ally_ai_checkup_questions` | CHUNK-CL1-NOTES, Found on the way | Live edits to those two prompts do nothing |
| `onboarding_eval.py` fails 11 of 13 at baseline | CHUNK-CL1-NOTES | The onboarding regression check is blind for this sprint |
| Open lines in `LAUNCH-CHECKLIST.md` | — | For example `sharedStoreWrites` and the backfill, `frame-ancestors`, the image bucket |

## 2. The honest maths

- **Left in v2:** 24 chunks (Stages 2–8). **v3:** about 10 epics (`v2-chunks.md`, Still in v3).
- **Pace so far:** slice 1 was 10 chunks between 7 and 11 Nov, with two sessions side by side on 10 Nov. About 2 chunks a day.
- **3 days × 14 hours with two sessions:** about 8–10 chunks, if each is small or medium.

All of v2 and v3 won't fit at any pace. What fits is **the part that changes what a business can do**. In stage terms, Day 3 ends with G1b from Stage 6, most of Stages 2 and 4 in light form, and the first v3 piece.

## 3. The cut

### P0: build in these 3 days

| # | Chunk | What owners get | Size | Lane · Day |
|---|---|---|---|---|
| 1 | **H0** Hardening (new) | The carried-over items fixed | S | A · Day 1 morning |
| 2 | **15a** Crisis classifier v2, then public links on | Public bot pages and a public website bubble (gate G1b) | S | B · Day 1 |
| 3 | **3b** Tool gateway | Nothing visible: every action from now on runs through it | M | A · Day 1 afternoon |
| 4 | **8a** Memory, light (7 and 8 cut down) | It remembers people: profile, preferences and open items, each with a source; Forget | M | B · Day 1 afternoon → Day 2 morning |
| 5 | **5a** Lists core (Collections, backend) | Generic lists with typed fields and rules: bookings, leads, orders, classes | M | A · Day 2 morning |
| 6 | **6** Generated list tools, with Do it and Never | "Book Thursday 11:15" creates a record; "slot taken" is explained | M | A · Day 2 afternoon |
| 7 | **5b** Lists in the dashboard | Build a list Notion-style, or add a ready-made one | M | B · Day 2 afternoon |
| 8 | **14a** Ask me first, light | Risky actions wait for the owner's approval | M | A · Day 3 morning |
| 9 | **21a** Privacy and caps, light | Forget and export cover memory and lists; a monthly message cap | S | B · Day 3 morning |
| 10 | **10a + 6F** Proactive messages (the first v3 piece) | WhatsApp template messages; reminders before a date and messages after a status change | M | B · Day 3 afternoon |

After these, a clinic can put its assistant on its website for anyone, have it book from its own slots, remember returning patients, hold late cancellations for the owner's approval, and remind people the day before.

### Why this order

- **15a first.** It's small and already specced, and it's the only gate between a demo and real customers.
- **3b before anything that acts.** Memory writes, list tools and approvals all go through one gateway with a per-run token and idempotency (CONTEXT: graph decides, ally-be executes).
- **Lists before templates.** A template is a saved arrangement of blocks; without Lists there's almost nothing to template. Ready-made lists (5b) cover the first customers.
- **Memory beside lists, not before.** Lists are what businesses pay for; memory is what makes them stay. Both need 3b and neither needs the other, so they run in parallel.
- **Ask me first after Do it and Never.** The two cheap modes ship with the tools on Day 2. Approvals land on Day 3 with a simpler design (§4) than graph interrupts.
- **6F + 10a as the v3 starter.** Reminders, review requests, campaigns, the daily digest and the owner on WhatsApp all need template messages. Build that rail once.

## 4. Each chunk, cut down

For each: what's in, decisions already made (so a session doesn't stop to ask), what waits, and done when. Claude Code still writes its code map and plan first; these are the deltas for its brief. Hours are rough wall-clock for one session.

### H0 Hardening · Lane A · Day 1 · about 4 h

Full brief: `chunk-h0.md`.

- **In:**
  - widen `wa_contacts.phone_e164` to `varchar(64)`, with a real-Postgres spec for retention and erasure;
  - a checkpoint retention job (30 days, daily, under the scheduler's advisory lock), needed only where `AGENT_RUNTIME__CHECKPOINT_DB_URL` is set; check production's setting first;
  - a warm-up call when ally-ai starts;
  - send the Skills Store overrides: `ally_ai_builder_change` with the builder's change call, `ally_ai_checkup_questions` with the checkup's question calls;
  - bring `onboarding_eval.py` up to purposes and the publish gate.
- **Alongside, not Claude Code:** release `0fb34139c`; the open lines of `LAUNCH-CHECKLIST.md`, ticked as they're done; Turnstile keys in production; the WhatsApp templates in §8.
- **Done when:** erasure and retention pass on real Postgres; a fresh ally-ai container answers its first searching question in under 12 s; `onboarding_eval.py` passes 13 of 13.

### 15a Crisis classifier v2, then public links · Lane B · Day 1 · about 6 h plus review

Full brief: `chunk-15a.md`.

- **In,** as in `v2-chunks.md`:
  - the classifier gets the person's earlier messages (up to 5, without the assistant's replies): a new optional field on `CrisisCheckRequest`, sent from all three engine call sites;
  - benign look-alikes in the prompt ("and what if I miss a day?", "I'm done for today", "dead tired");
  - the eval extends the conversation basics suite (`ally-be/src/chatbot/basics`, `npm run chatbot:basics`) to about 30 real crisis phrasings (English, Hindi, Hinglish, indirect) and about 30 look-alikes, each asked 3 times, keeping its must-pass rules;
  - today's prompt measured on the same set first.
- **Gate:** 0 missed crises in every run, and fewer false alarms than today. Published as a new Skills Store version after Shehbaz reads the set and the text (Day 1 midday check).
- **Then G1b:** `botPagePublicAllowed` on for one internal bot and one pilot bot. Check rate limits, the daily cap and Turnstile on the public page and in the bubble.
- **Decided:** keywords stay as they are. No confidence floor unless the eval shows it cuts false alarms with 0 misses.
- **Waits:** a different classifier setting per safety pack.

### 3b Tool gateway · Lane A · Day 1 afternoon · about 8 h

- **In,** following the gateway section of `three-stage-plan.md`:
  - `POST /internal/agent/tools/:name`, with the service secret plus a short-lived `run_token` naming the bot, contact, conversation and allowed tools;
  - `tool_runs`, keyed by run id plus step, so a replayed call returns the stored result;
  - a per-bot allow-list (no screen yet);
  - a gateway tool base in ally-ai's registry, so a new tool is one file on each side.
- **Decided:**
  - `search_knowledge` stays in ally-ai with no gateway hop (latency). Only tools that read or write ally-be data go through the gateway.
  - Gateway calls time out at 5 s; the 4-step cap and the 15 s run budget stay.
  - The idempotency key in `tool_runs` is the redelivery guarantee. Since `0fb34139c`, production may run without stored checkpoints, so don't rely on LangGraph returning a stored run for a repeated run id.
- **Proving tool:** `hand_over`, wired to 11a's Needs a person (new reason: the assistant asked), off by default per bot.
- **Done when:** a tool call shows in Try it's steps and in `tool_runs`; the same call replayed runs once; a disallowed tool is refused; bot A's token can't reach bot B.

### 8a Memory, light · Lane B · Day 1 afternoon → Day 2 morning · about 10 h

- **In:**
  - `memory_entries` as in `TEMPLATE-DATA-MODEL.md` (preferences, context and open items; source message, source kind, date, expiry, status), rendered as a USER.md block and loaded into every run within a budget;
  - profile fields on `chatbot_contacts.profile`, defaults only: name, language, phone, email, preferred times;
  - `remember` and `recall` through the gateway;
  - never-store per bot; health packs keep non-clinical details only, enforced in ally-be, not by the prompt;
  - the profile beside a chat in the Inbox: every line with its source, edit, forget a line, and Forget this person.
- **Decided:**
  - A public visitor's memory lasts as long as their visitor cookie. A verified email or a WhatsApp number makes it durable.
  - How the agent uses memory goes in a new seed prompt section, `ally_ai_agent_memory`, not an edit to `ally_ai_agent_system`. Its text is approved at the Day 2 midday check.
- **Waits:** custom profile fields and file types, relations, a People page, the nightly tidy, the notebook, carrying a profile across channels (Continue on WhatsApp).
- **Done when:** "I prefer evenings" in one chat is used in the next; the Inbox shows it with its source; Forget removes it and the next run doesn't know it; a never-store item, and a clinical detail on a health pack, are refused; 0 hard fails on the 3a conversation eval plus new memory cases.

### 5a Lists core · Lane A · Day 2 morning · about 8 h

- **In:**
  - `collections`, `collection_fields`, `collection_constraints`, `collection_records`, `record_links` and `record_events`, as in `TEMPLATE-DATA-MODEL.md`;
  - field types: text, long text, number, money, date, date and time, duration, select, yes/no, phone, email, URL, and relation (to a contact or another list);
  - constraints: required, unique (with a where), capacity, limit per person and status transitions, inside one transaction with a lock;
  - the agent's read and write per list and per field; never-store and masked fields;
  - CSV import and export; the limits (50 lists, 100 fields, 200,000 records per bot).
- **Decided:** no recurrence engine. The dashboard's "Repeat weekly until" creates the records (5b).
- **Waits:** recurrence, board and calendar views, rollups, formulas, waitlists, rules tables.
- **Done when:** Slots and Appointments built by API; a taken slot is refused with a reason; the 21st booking in a class of 20 is refused; transitions hold; specs on real Postgres.

### 6 Generated list tools, with Do it and Never · Lane A · Day 2 afternoon · about 6 h

- **In:**
  - `find_<list>` (equals, range, contains, sort, limit, count and sum; readable fields only; results are passages it must cite);
  - `create_<list>` and `update_<list>` (allowed fields and transitions only);
  - all through the gateway, with constraint failures returned as plain reasons;
  - an `abilities` row per tool, set to Do it or Never and checked in the gateway (Ask me first arrives in 14a).
- **Decided:**
  - `_trim_booking_offers` and `_send_back_slot_offers` skip an assistant with a writable list (CHUNK-20A2-NOTES, booking slice). Assistants without lists keep both checks.
  - The purpose cards' honest limits ("It can't book…") change only for assistants with a writable list. New lines go in the copy deck.
  - How the agent uses lists goes in the tools' descriptions plus a new seed section, `ally_ai_agent_lists`, approved at the Day 2 evening check.
- **Waits:** `check_rules`, citing a record in Why?, WhatsApp buttons for picking a slot (chunk 10).
- **Done when:** in Try it, "2BHK under 85 lakh" filters a listings list; "book Thursday 11:15" creates a record; a taken slot is explained; a Never tool can't run; the Sunrise and fixture checkups are unchanged (0 hard fails, 0 wrong declines); action cases added to the conversation eval.

### 5b Lists in the dashboard · Lane B · Day 2 afternoon · about 7 h

- **In:**
  - a Lists section on the assistant's home: a table with filters, add and edit fields, and rules in plain words ("only one booking per slot", "at most 20, then it's full");
  - CSV import and export; "Repeat weekly until";
  - the agent's read and write switch per list, and Do it or Never per action;
  - **ready-made lists, as data:** Appointments with Slots, Leads, Orders, Classes;
  - copy in a new deck section.
- **Waits:** board and calendar views, saved filters, field permissions for staff roles.
- **Done when:** an owner adds Appointments with Slots, sets next week's slots, and books one through Try it; Playwright at 1440 and 390 px with axe.

### 14a Ask me first, light · Lane A · Day 3 morning · about 8 h

- **In:**
  - Ask me first on any list action. The gateway parks the call in `tool_runs` as awaiting approval, and the agent tells the person the team will confirm.
  - The owner sees it in Needs you on the Overview, and gets an email linking to it.
  - Approve runs the parked call once (idempotent) and sends a fixed confirmation on the conversation's channel. Decline sends a fixed "the team couldn't confirm" line. Unanswered requests expire after 24 hours and nothing runs.
- **Decided:**
  - No graph interrupt or resume in this pass; the confirmation is a fixed line, not a new agent run.
  - The email link opens a signed-in confirm page and never acts on a plain link visit, because mail scanners open links.
  - WhatsApp outside 24 hours uses a 10a template when one is ready, otherwise email.
- **Waits:** approvers other than the owner, Approve buttons on WhatsApp (chunk 10), interrupt and resume (full 14).
- **Done when:** "cancel my booking for tomorrow" waits; Approve cancels it and the visitor sees the confirmation on the bot page; a second Approve does nothing; Decline tells them.

### 21a Privacy and caps, light · Lane B · Day 3 morning · about 3 h

- **In:**
  - Forget this person also removes memory and the profile, and masks the person's fields on list records (the records stay for the business, shown as an erased person);
  - export one person as JSON: profile, memory, conversations and records;
  - memory follows the bot's retention;
  - a monthly message cap per bot, on top of 12b's daily cap.
- **Decided:** a cap in rupees waits for per-bot cost attribution (LLM usage isn't keyed by bot today). Masking rather than deleting records is a default to confirm with whoever owns DPDP compliance.
- **Done when:** export, then Forget, end to end on real Postgres, across WhatsApp, the bot page and the bubble.

### 10a + 6F Proactive messages · Lane B · Day 3 afternoon · about 8 h · the first v3 piece

- **10a, WhatsApp template messages:** sync a number's approved templates from Meta; send a template with variables; record delivery statuses from the webhook; list templates under Share → WhatsApp numbers.
- **6F, follow-ups light,** as in `TEMPLATE-DATA-MODEL.md` (`follow_ups`, `follow_up_runs`):
  - triggers: a time offset from a date field on a list ("24 hours before the slot starts"), or a status change ("2 hours after completed");
  - sent to the person on the record, by WhatsApp template, else email;
  - quiet hours (21:00 to 08:00 in the business's time zone by default), once per record, opt-out checked at send;
  - runs on the 5-minute scheduler job with a key per follow-up and record;
  - two ready-made follow-ups: Appointment reminder, and Ask for a review (a link only).
- **Waits:** submitting templates to Meta from the dashboard, rating buttons with branches, broadcasts and segments, a bot page message waiting for their next visit.
- **Testing:** template sends need a real number with approved templates, so test them in staging, not on the local stack.
- **Done when:** a booking for tomorrow gets exactly one reminder at the right time, and none again after a restart; STOP before the send means no send; quiet hours move it to the morning.
- **Stretch, if Day 3 runs ahead:** "Send to a URL". A signed POST on list events through the guarded fetcher, with retries. Every CRM or sheet through Zapier, Make or Pabbly, with no connector code.

## 5. The schedule

Two Claude Code sessions: **Lane A** (gateway and lists, mostly ally-be) and **Lane B** (safety, memory, dashboard and messages). The local stack runs one checkout, so when both lanes need it they share the folder and the branch (`feat/agents-v2-fast-track`), as 11a and 13 did, and each commits only its own paths. Separate worktrees only for a lane that doesn't need the stack at the same time.

| | Lane A | Lane B | Shehbaz (reviews and ops) |
|---|---|---|---|
| **Day 1** | H0 → 3b | 15a → G1b → 8a (tables, the Inbox panel) | First: release `0fb34139c` and watch v1 fallbacks. Then read the crisis eval set and prompt (midday); Turnstile keys; submit WhatsApp templates; the launch checklist |
| **Day 2** | 5a → 6 | 8a (tools, evals) → 5b | Approve the memory and lists prompt sections; review 3b and 8a |
| **Day 3** | 14a → integrate both lanes, full suites, evals, deploy dark | 21a → 10a + 6F | Pilot flags on in the evening: one clinic assistant, one lead assistant |

**Reviews:** 13:00, 19:00 and 09:00 the next morning, 20–30 minutes each. Read the plan or report, answer what the session parked, merge what's green into the integration branch.

**Shipped means:** built, tested, merged and deployed dark, with flags on for the pilot assistants. G2a and G2 close only after a week or two of real pilot use.

**With only one session:** H0 → 15a → 3b → 5a → 6 → 5b → 8a. Approvals, privacy and proactive messages move to the next sprint.

**If a day slips, drop in this order:** 10a (keep 6F on email), then 14a (Ask me first falls back to handing over to a person), then 5b's ready-made lists (create them from CSV).

## 6. Next: P1, the next sprint, in order

1. **20e Landing page.** Its brief is ready, and public links unlock it.
2. **9a Voice notes in.** Transcribe Hindi, Marathi and Hinglish voice notes before the agent runs (ally-ai already talks to Sarvam). Big for WhatsApp in India.
3. **14, the rest.** Interrupt and resume, other approvers, Approve buttons on WhatsApp.
4. **10 Rich messages.** Buttons and lists for picking slots; documents out.
5. **18a Templates, light.** Export and install an assistant with its lists, abilities, follow-ups and checkups. The ready-made lists become the first official templates.
6. **Memory, the rest.** Custom profile fields, file types, relations, the nightly tidy, Continue on WhatsApp with memory carried over (closes G2a with a pilot).
7. **The organisation's name made explicit,** replacing the `organisation_of` guess (CHUNK-03A-NOTES §11; CHUNK-20A-EVAL item 7).
8. **Lists, the rest.** Recurrence, board and calendar views, waitlists, `check_rules`, rollups.
9. **Send to a URL,** if it didn't make Day 3.
10. **Checkups for actions.** The grader checks that a record was created, refused or held for approval.

## 7. Can wait: P2

Each is real, but none changes what a business can do in its first month.

| Chunk | Why it waits |
|---|---|
| 4 Workspace (pages in a file tree) | A large refactor. Owner notes and documents cover it for now; do it when roles or expiring updates are needed |
| 16a History search and summaries · 16b Why? everywhere | Why this answer exists in Try it; the inbox covers reading chats |
| 8L Learns from conversations | Answer it, Correct this and Add to checkup are the manual loop today |
| Q1 and Q2, the rest | Nightly checkups, alerts, WhatsApp thumbs. The core is built |
| 11 Full team inbox | Assignment, notes and SLAs. 11a covers one small team |
| 15 Learning mode · 17 Owner on WhatsApp | 17 needs 10a and the rest of 14 first |
| 19, 20 Template builder, sharing, onboarding from a template | After 18a has real templates |
| 21, the rest | Per-template evals in CI, load test, the v1 migration tool |
| CL2 Remove v1 | Waits on the calendar: 4 weeks with 0 fallbacks, counted from the release of `0fb34139c` |

## 8. v3 proper: P3, and what to start today

**Start today; these take days to weeks outside the code:**
- **WhatsApp utility templates** (appointment reminder, booking confirmed, review request), submitted on each pilot's WhatsApp Business Account, since templates belong to the account. Needed by Day 3.
- **Meta Tech Provider status,** needed for Embedded Signup (one-click WhatsApp).
- **Turnstile keys** and the `/b/*` rules in production.
- **Two pilot businesses,** a clinic and a lead-led business. G2a and G2 close only after real use.
- **A native Hindi speaker** for the bot page strings marked "needs review".

**Then, in this order:**
1. Broadcasts and campaigns, plus the daily digest, on 10a's rail.
2. A calendar connector (Google Calendar or Cal.com) to sync bookings.
3. Payments (Razorpay links).
4. Any API, OpenAPI or MCP server as a tool: a gateway tool type, cheap once 3b and 14 exist.
5. Forms and WhatsApp Flows, writing list records.
6. Embedded Signup.
7. Later: the visual flow builder, fully automatic learning, the public template gallery and skills store, Slack and Teams, custom domains.

## 9. How to run the three days

- **Decisions made in the brief.** §4 is written so a session doesn't stop to ask. It records its choices in its notes and stops only for prompt text, anything that loosens safety, a destructive migration or a new dependency.
- **Ship dark, review behind.** Every chunk sits behind a flag, so review can trail the build by half a day without blocking the next chunk. The exception is 3b, which blocks 8a's tools, 6 and 14a.
- **Avoid merge pain:**
  - Migration timestamps: after the newest on master (today `1981900947000`), with a block per lane so they never collide (for example Lane A from `1981901000000`, Lane B from `1981902000000`).
  - Copy deck: Lane A writes §26 (lists, approvals), Lane B §27 (memory, follow-ups, templates).
  - Shared registries (ally-ai's tool registry, the gateway's registry, `LlmTask` and `ai-task-registry.constants.ts`): change them in a small commit of their own, and merge 3b first.
  - Shared docs (`LAUNCH-CHECKLIST.md`, `v2-chunks.md`, the root `CLAUDE.md`): edited only in a lane's last commit, after reading `git diff` on them.
- **Faster test loops.** Focused tests while building; full suites once per milestone commit. The hook runs them, so commit per milestone, never with `--no-verify`.
- **Evals in quiet windows.** During CL1 and 3c, evals run while another session compiled gave timeouts and v1 fallbacks that weren't real. Run evals only when the other lane is idle (at the 13:00 and 19:00 reviews), and 3× only for 15a and the Day 3 gate.
- **One brief at a time per lane,** as now. Each ends with its NOTES file and its row in `v2-chunks.md`'s Progress table.

## 10. Risks

| Risk | What to do |
|---|---|
| Production moves from v1 to the v2 agent when `0fb34139c` ships, mid-sprint | Ship it on Day 1 morning, before anything else lands; watch fallbacks, reply times and crisis replies for a few hours |
| 15a reaches 0 misses but false alarms don't drop | Misses are the hard line. Whether public links still go on is Shehbaz's call |
| The agent over-books or invents slots once it can write | Ask me first on create for each pilot's first week; action cases in the evals; the slot check stays on for assistants without lists |
| Gateway calls push replies past 20 s | One hop to ally-be with a 5 s timeout; the step cap and run budget stay; watch the v1 fallback rate |
| Memory stores something it shouldn't | Allowed fields only, enforced in ally-be; health packs non-clinical; every line sourced and forgettable |
| Template sends can't be tried locally | Staging with a real number; email as the fallback channel |
| Review becomes the bottleneck | The three reviews are fixed; anything not reviewed stays dark |
