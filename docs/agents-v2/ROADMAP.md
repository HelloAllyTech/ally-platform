# Ally Agents: the plan (23 Nov 2026)

> **The one plan.** Everything built, decided and planned for Ally Agents, from the original v2 plan (`v2-chunks.md`, `agents-v2-spec.md`, `three-stage-plan.md`) through every chunk, test round, review and decision up to 23 Nov 2026. It replaces `FINAL-PLAN.md`, `MASTER-PLAN.md`, `7-DAY-PLAN.md`, `NEXT-STEPS-18NOV.md`, `NEXT-STEPS-20NOV.md`, `10X-PLAN.md`, `ROADMAP-NEXT.md` and `STATUS.md`; their detail and sources still hold where this file points to them. Active briefs: `chunk-q4.md` (building), `chunk-bt1.md`, `chunk-rc1.md`, `chunk-t2.md`. Test suite: `EVAL-USECASES.md`. Root causes: `FIXES-22NOV.md`. WhatsApp: `WHATSAPP-GAPS-PLAN.md`. Demos: the "Ally Agents demo playbook" doc. Durations are estimates at the current pace. <!-- docs-path-lint: planned -->

## Contents

1. What Ally Agents is, and how it wins
2. What's built
3. Where we are today
4. Phase 1 — Invite-only launch
5. Phase 2 — WhatsApp that reaches people
6. Phase 3 — Provably right, and a clean core
7. Phase 4 — Acts on its own, for organisations
8. Phase 5 — Anyone can run it
9. Phase 6 — Connects and shows its work
10. Phase 7 — Remembers and learns, with approval
11. Later (v3)
12. Cut or parked
13. Gates
14. Decisions log
15. Follow-ups and known debt
16. Outside the code
17. How every block runs
18. Which docs are current

## 1. What Ally Agents is, and how it wins

**The product:** an assistant an organisation sets up from its website, documents or a template in minutes, that answers the people it serves on WhatsApp, its own page and a bubble on its website, **from its own information, safely**, and **does things for them**: books, registers, takes applications and callbacks, looks up orders, follows up. The owner sees and controls everything and pays for what it uses.

**Who first:** non-profits, NGOs, helplines and mental-health organisations (the six organisation templates and the sign-in page lead with them), then clinics and lead-led businesses. **Wedge:** the assistant an organisation can trust with the people who matter to it, proven with numbers anyone can re-run, and open.

**Competitors** (Wati Astra, AiSensy, Interakt, Gallabox) are ahead on breadth and sell to sales, support and commerce teams. Ally doesn't race them on features: it wins seven measurable claims and reaches parity only on the table stakes that block adoption (on WhatsApp: templates, broadcasts, contacts, buttons, self-serve connection). Commerce is skipped.

| # | Claim | Target | Earned in |
|---|---|---|---|
| 1 | Fewer wrong or unsafe replies | 3 or fewer per 100 in-data questions (today about 20) | Phase 3 |
| 2 | Safe for sensitive work | Emergencies and at-risk messages right on every pack, in 8 Indian languages; safety on outbound too | Phases 1–4 |
| 3 | Never acts without a yes; never double-books | 0, on production and on WhatsApp, every round | Phase 1 |
| 4 | Works for organisations, not only sellers | 40 use cases passing end to end, with surveys, onboarding, learning, campaigns | Phase 4 |
| 5 | Every broadcast is a conversation | Campaign replies answered in context, booking or registering with consent; consent you can show; Meta's price shown before sending, no markup; a number that stays healthy | Phase 2 |
| 6 | Open and owned | Self-host in under 30 minutes, any model key, full export | Phase 5 |
| 7 | A tenth of the cost for a small organisation | Measured per 1,000 conversations against the cheapest competitor | Phase 5 |

**Distribution competitors can't copy:** a not-for-profit with an MIT codebase can be listed as a digital public good, partner with NGO networks and helplines, and be adopted by state programmes; one reference organisation per organisation template; the open benchmark and eval sets as marketing.

## 2. What's built (on production, 23 Nov)

| Area | Chunks | What people can do |
|---|---|---|
| **Engine** | 1, 2, 3a, 3r, 3c, 3d, Q3-fast | The LangGraph agent on one run path (no v1 fallback), streaming, a fixed reply when a run fails |
| **Setup** | 20a-1, 20a-2, 20d, 20d-2, Q2a | An assistant from a website: reading with sources, the safety pack, gaps asked, purposes, design, checkup, the publish gate, change by chat, Try it, the assistant home (Overview, What it knows, Tools, Safety, How it works, Try it, Checkup, Inbox, Share), a light scorecard |
| **Templates** | T1 (was 18a light) | 6 organisation templates (Helpline and crisis support, Services and eligibility, Donors and volunteers, Staff and volunteer onboarding, Reach more communities, Campaigns and urgent updates) and 11 business templates, from setup or Tools; names shared with the sign-in page |
| **Channels** | 12, 12b, 13 | Bot page (public, organisation-only or invited, pre-chat questions, branding), website bubble, WhatsApp (connected by Ally) |
| **Safety** | 15a, H0, SP1, Q3-fast, 6b, H1 | Six packs (facts only, mental health, medical, pharmacy, young people, legal and financial), only ever stricter; the crisis check with three levels; fixed crisis and emergency replies in English, Hindi and Hinglish; clean declines; owner pack correction |
| **Actions** | 3b, 5a, 5b, 6, 6b, H1 | The tool gateway; lists with rules (unique, capacity, per person, transitions), 14 ready-made lists, Repeat weekly; look up, add, change with Do it / Never; consent for every write (a yes in a later turn, checked in the gateway); live steps and confirmation cards |
| **People** | 8a, 11a | Memory light with Forget and summaries; hand-over and the Inbox (take over, hand back) |
| **Access** | A1, CR1 | Owners only (owner, editor, viewer), login without sign-up, assistants in their own space; custom logins as a limited "Assistant owner" role; the old WhatsApp number system hidden |
| **Money** | CR1, CR3 | Ally admin → Models (versioned prices, WhatsApp rates) and → Costs (by creator, assistant, kind, model, channel; fixed costs; alerts; CSV); plans (Free 3 published assistants, Pro 20, internal) and seats (5 included, extra Basic or Premium renewing on their own dates); a monthly spend cap per creator in dollars (replaced token allowances); polite limit replies; crisis replies at every limit |
| **Speed** | H1 | Streamed replies, a status line at once, a 45 s cap that times out on silence, search before the first call, the crisis check in 6 s (local: 0 fallbacks, median 8.4 s) |
| **Cleanup** | CL1 | No behaviour change; prepared for launch |

## 3. Where we are today (23 Nov)

- **Production rounds 20–22 Nov:** six NGO use cases on real organisations, Robin Hood Army on its live page (2 pass, 10 partly, 6 fail of 18), Round 7 (template-built iCall), Round 8 (Akshaya Patra, Jaipur Foot, Vandrevala live, Uday Foundation: 11 / 9 / 7 of 27). Six root causes (`FIXES-22NOV.md`): hand-over replacing answers; search tied to the question's language; key facts left to search; WhatsApp rules leaking onto the web; the booking question naming the wrong fields; templates not fitting the organisation. Plus: publishing blocked by the safety recheck, the wrong safety pack, the word "unchanged" leaking into a name and a reply.
- **▶ Q4 light is building** on `fix/agents-v2-q4`. The use-case suite is built (13 sets, about 297 cases). Done: the suite and grader (three grading views, hand rulings), publishing prompts (A0), safety prompts A1–A5, hand-over never replaces an answer (14 → 0), key facts in context, search in English as well, hybrid (keyword + vector) search with neighbour chunks, struck-out prices, "answer instead of which one?" (D1). Measured 23 Nov, like for like: in-data right 57% → 62% (target 85%; the rest moves to Phase 3), non-English in-data 41% → 53%, "asked back instead of answering" 27 → 12, saves with exactly one confirmation 8 of 8, emergencies 25 of 26 (a bystander emergency missed on a non-health pack). Still to do: the rest of A, section H from the demo build (an at-risk message missed mid-conversation on the live page; emergencies on every pack), B, D (stop 3), E, F and G+. About Fri 28 Nov.
- **Demo build on production (23 Nov, `DEMO-FINDINGS-23NOV.md`):** Sukoon, Haq Seva and Annapoorna live (invite-only); Raah and Mann Collective blocked by the publish 409. Every finding is in Q4 section H, RC1, BT1 or later.
- **WhatsApp on production (23 Nov):** the Ally number (+91 96199 99081) is connected to Sukoon Therapy through the owner's Connect flow and answers; invite-only applies on WhatsApp (an unlisted number gets the refusal, after the crisis check). The server needed `WHATSAPP_CREDENTIALS_ENCRYPTION_KEY` (added to production's settings and in RC1's `launch:check`).
- **WhatsApp today is a reply engine:** it answers people who write first, in plain text, safely; it can't send templates, buttons, lists, images or documents, declines voice notes and files, keeps delivery status only for cost, and its contacts have no names, tags or segments.
- **Live test data to tidy:** Vandrevala is live at `/b/unchanged` (rename or unpublish until Q4 ships); BHIVE, Robin Hood Army and the 20–22 Nov drafts.

## 4. Phase 1 — Invite-only launch (target about Fri 27 Nov, fast track decided 23 Nov; see the decisions log)

Ally onboards each organisation itself: no sign-up, no online payment, Ally connects their WhatsApp number. Two pilots first (one an organisation), then the first 10–20 invited, one at a time, watched daily; a weekly feedback review sets Phase 2's order. One session at a time: Q4 → Book by tap → RC1.

### 1.1 T1 Use-case templates — ✅ released 22 Nov (`chunk-t1.md`)

### 1.2 Q4 light: fix what the rounds found — ▶ building, about 28 Nov (`chunk-q4.md`)

- **§0 The use-case suite** (`EVAL-USECASES.md`): the six organisation templates on iCall, CanSupport, Goonj, Teach For India (plus a staff handbook) and Robin Hood Army; five business assistants that failed before (Dr Agarwal's, Cloudnine, The Souled Store, Scripbox, 91springboard/BHIVE); the Robin Hood Army and Round 8 sets with their "should be" answers; about 25 messages each (facts incl. Hindi and Hinglish, not-in-data, look-alikes, emergencies, the template's action, off-topic, use-case checks) plus the owner side; 3 runs for final numbers; launch targets per template.
- **Grader first** (hand rulings at 95%, only what was asked, referrals not "invented", refusals pass, conflicting facts named; the checkup's counts add up; similar size per assistant; every pack's safety questions).
- **A — Safety and publishing:** publishing works (the recheck runs in the background with a status; the 70% gate); hand-over never replaces an answer (only on request or after an unhappy answer; its lines in Hindi and Hinglish); crisis numbers only from confirmed Safety settings, each with its source, the pack's numbers always present on upset messages, never "I don't have crisis numbers"; emergency keywords per pack when the classifier fails (bleeding, chest pain, can't breathe, stroke signs, overdose, waters broken…); the right pack (care the organisation itself provides; Young people for schools and coaching; at most one care topic) with "This isn't right for my business" and typed corrections that change the pack; "Do I have depression?" declined well; medicines and allergies declined, not handed over; graded urgency (see a doctor today vs emergency now); palliative wording; safe setup previews; the word "unchanged" never in a name, slug or reply; the 3am message on a 24×7 helpline.
- **B — Booking and leads:** Try it says "Test booking, not saved" and stays consistent; pre-chat details used, one question, one yes; the question and card name date, time, venue and quantity (no "book 0"); dates folded into the one question; "which slots are free?" always looked up, all of them; alternatives after any refusal; callbacks saved under the person's name; "Bring in customers" creates its Callback list and never offers what it can't do; the wizard's "Do it" sticks; checkups run as a named test person; booking for someone else (their name said back).
- **C and G — Answers:** no citation markers on the live page; the same facts in every language (search in English too); struck-out prices dropped; no stray or internal text; channel rules only on WhatsApp; key facts always known; low-value pages (privacy, app pages, leaderboards) kept out of answers, starters and contacts; the name-and-phone offer only when it helps; answer instead of "which one?"; the right number; one polite decline; worried and medicine questions never a bare "I don't know"; memory keeps names from list conversations; the owner's answer wins over the website; no other country's documents.
- **D — Speed:** cheaper rewrites; "minimal" reasoning measured (stops for your OK); the WhatsApp typing indicator; cold start warmed.
- **E — Setup under load:** no "Something went wrong" with five setups at once (the database connections); first checkup question and publishing under 15 s.
- **F and G+ — Small fixes:** setup copy, the share domain, live counts, the shouted headline, the "Replace them" link, the Campaigns template's "Set it up"; quick questions skip what the template asked; template answers (locations, hours) used; checkups built around the template.

### 1.3 WhatsApp Stage 0: your number — Shehbaz, this week (no code) — 🟡 mostly done

Done 23 Nov: business verified; number connected and answering on Sukoon; webhook subscribed; system-user token. Left: a payment method (in rupees), the 5 templates submitted, two-factor authentication for everyone in the portfolio, the Tech Provider application, App Review and publishing the Meta app.

Verify the business with Meta; display name and profile; connect the number to an internal assistant; subscribe to message, template-status and quality webhooks; submit 5 templates (appointment reminder, booking confirmed, callback follow-up, event update, opt-in confirmation), wording approved by you; note the 250-a-day starting limit; confirm rupee billing before 31 Dec.

### 1.4 The live-page and WhatsApp round — after Q4 is deployed (0.5 day)

The suite's action conversations on the live page and WhatsApp; real bookings, two customers and one slot, a move, the per-person limit, memory across chats, the callback email; on WhatsApp the booking conversation, memory, a failed run; emergencies 3 times each on a medical and a maternity assistant; Hindi and Hinglish at-risk messages; +custb asking for +custa's booking; five chats at once; the spend-cap replies.

### 1.5 BT1 Act by tap — ▶ built 24 Nov, waiting for review (`chunk-bt1.md`, `CHUNK-BT1-NOTES.md`; decided 22 Nov in place of T2)

Slot chips from the list (never from text); a confirmation card built in code (what, when, where, how many, for whom) with Confirm and Change; Confirm is the yes, written once through the same rules, no model call; done cards titled by list ("Booked", "Registered", "Callback requested", "Application received") with Cancel and Move, each confirmed; callbacks, applications, volunteer shifts and registrations too; Try it marks "Test, not saved"; up to 3 suggested-question chips; **WhatsApp's first interactive sends** (list messages, reply buttons) with a numbered-text fallback outside 24 hours; signed single-use action tokens; a crisis between taps wins.

### 1.6 RC1 Before real customers — about 5 Dec (`chunk-rc1.md`)

- **Tests that run:** Postgres in CI; the red tests fixed.
- **Privacy (21a, DPDP):** export a person's data (profile, memory, conversations, list entries, files, consent); erase a person end to end (search entries and caches too; costs keep no personal data), requested by the person and confirmed by the owner; retention per assistant (365 days, health packs 180); consent recorded for web contacts and WhatsApp opt-in.
- **Seeing problems:** error tracking on all three apps (personal data scrubbed); a daily summary to Ally and each owner (conversations, fallbacks, failed runs by stage, refusals, hand-overs waiting, crisis counts, thumbs-down, spend); "Tell us what's missing".
- **Small fixes:** no "I'll pass it on" with hand-over off; the Overview's hand-over count; short hand-over summaries; the therapist-joke fail; Hindi strings listed for review; a customer sign-in not logging the owner out; stale counts; the missing logo; the footer disclaimer following the pack; ignored clicks in setup; sources labelled by page title; conflicting phones and emails asked about.
- **WhatsApp platform checks:** Meta's business-scoped user ID for people with usernames (since 31 Mar 2026); the "Custom" purpose reviewed against Meta's ban on general-purpose assistants (since 15 Jan 2026).
- **Ready to launch:** SP1's second onboarding run (lifts the hold on medical, pharmacy and young-people assistants if it passes); a read-only `launch:check`; `CONTEXT.md`, the Progress table and the docs README current.

### 1.7 The gate round, then launch — about 8 Dec

The use-case suite on production (3 runs) plus Round 5's set, on the live page and WhatsApp. Then the pilots.

**The launch gate:** 85%+ in-data over 3 runs per organisation template · starter checkups 70%+ · no Serious finding · emergencies right on every pack tested, under 6 s · 0 writes without a yes, on the live page and WhatsApp · no slot booked twice · a booking by taps on WhatsApp in 3 taps or fewer · 0 fallback replies · status line under 2 s, median reply under 12 s, first words under 8 s (speed gate to confirm) · crisis reply at the spend cap · "You're ready" never shown at a low score.

**Launch checklist:** Free and Pro cap amounts entered · each live assistant's own crisis line confirmed in Safety (Vandrevala first) · approved prompts published to production's Skills Store · reasoning effort and model overrides checked on production · the cost queue set · the backfills run · each client's WhatsApp number connected · a short onboarding guide for invited owners (from `USER-GUIDE.md`) · who answers support · privacy policy and terms cover conversations, memory and list entries · test assistants and data cleaned up · old worktrees removed.

**Demos for prospects** (the "Ally Agents demo playbook" doc): template-led, three acts (build from a template card and one PDF in 3 minutes, the conversation, the team's view); five fictional organisations (Raah helpline, Haq Seva scheme desk, Annapoorna food bank, Mann Collective onboarding, Sukoon Therapy booking); what's safe to show today, after Q4 and after Book by tap; next: the five PDFs written in full.

## 5. Phase 2 — WhatsApp that reaches people (about 3 weeks, December; `WHATSAPP-GAPS-PLAN.md`)

Every pilot will ask for reminders first. This replaces the old "Outbound and the Scheduler" block.

| # | Block | What's in it | About |
|---|---|---|---|
| 2.1 | **Stage A, reply parity** | Interactive, image and document sends beyond BT1's; voice notes transcribed in Hindi, Hinglish, Marathi and more (the monorepo's Indian speech providers) and answered; images and documents accepted where a list field takes a file, declined politely otherwise; delivered, read and failed per message, shown in the Inbox | 3 days |
| 2.2 | **Stage B, outbound foundation** | Template manager (create, submit to Meta, track approval, variables, language versions); contacts (name, tags, custom fields, CSV import, segments from lists and chats); an opt-in ledger (when, how, for what); one send engine (24-hour window, a template outside it, opt-out and quiet hours at send time, idempotency key, pacing to the daily limit, retries only on transient failures). First uses: booking confirmation, the reminder the day before, callback follow-up | 4 days |
| 2.3 | **Stage C, campaigns** | Broadcast to a segment, now or scheduled; a cost and skip preview before sending (count, category, rupees, who is skipped and why); a test send; results (delivered, read, replied, clicked, opted out, failed with reasons); re-send to non-readers; tracked links; a quality guard and automatic pause; **replies answered by the assistant with the campaign as context**; "describe it" drafting ("remind everyone booked tomorrow at 6 pm") into a template, an audience and a preview to approve | 4 days |
| 2.4 | **Stage D, acquisition, light** | The ad or link source on a person's first message, on the contact and in reports; wa.me links and QR codes per assistant with a prefilled message; "Continue on WhatsApp" from the bot page and bubble, carrying memory and history | 2 days |

**Safety on outbound, always:** crisis wins; health reminders say only the time and place; no marketing to someone in an at-risk conversation; quiet hours by default; opt-out in any language the assistant reads.

**Gates:** after A, a Hindi voice note answered and delivery status in the Inbox; after B, a reminder reaches a test contact the day before, outside 24 hours, once, never to an opted-out contact or in quiet hours, and a retry never sends twice; after C, a 200-person test broadcast with the cost within 5% of the bill, results matching Meta's, replies answered in context, the automatic pause triggered by a forced failure spike.

## 6. Phase 3 — Provably right, and a clean core (about 2–3 weeks; can run beside Phase 2 in a second worktree)

| Block | What's in it |
|---|---|
| **The public benchmark** | 10 Indian organisations' sites × 30 questions (facts, not-in-data, look-alikes, emergencies, a booking, Hindi and Hinglish); Ally and each competitor's default agent; question sets, scoring and runner open in the repo; read each product's terms before publishing names |
| **Answers to 95%** | Keyword search beside vector search; two questions in one message; duplicate and conflicting facts ("45 hubs" and "49 hubs") flagged; add a fact after setup; Q4's remaining items; combined packs (Medical + Young people); finance wording ("nothing is guaranteed"); the gaps doc's owner-screen items (share link, "Run only failed", lost "Add it now" answers, ready-made examples, thumbs-down notes shown); the same signed-in person on public pages; fine-tuning a model only if the suites plateau |
| **Speed to parity** | Median under 5 s, first words under 3 s: a faster model or lower reasoning for plain turns, one call for upset and medicine turns |
| **Quality that can't slip** (Q1, Q2 rest) | Evals in CI on every prompt change; nightly checkups with regression flags ("worse since Tuesday's change"); scorecard alerts when the answered share or checkup pass rate drops; saved real chats replayed before publish; thumbs on WhatsApp; declined and thumbs-down questions suggested as checkups |
| **Safety reviewed** | A clinician reviews the at-risk and emergency wording, the pack rules and any screening; pack choice tested on 20 varied sites; maternity, lab and vet packs |
| **Clean the core** (R2, CL2) | LangGraph reviewed against its docs; the checkpointer decision; readable code and `ARCHITECTURE.md`; the repeated-API-calls fix; per-run tracing for the team (privacy-safe); delete the v1 code (4 weeks after release with 0 fallbacks); the shared store as the source of truth (stop the dual-write); Meta profile names |

**Gate:** claim 1 or claim 2 shown on the benchmark. Nothing is called "10x" in public before that.

## 7. Phase 4 — Acts on its own, for organisations (about 3–4 weeks)

| Block | What's in it |
|---|---|
| **T2 Templates that fit** (`chunk-t2.md`, minus what Q4 took) | Key-fact questions per template (hours, "we don't take money", "not an emergency service"); setup and starter questions that fit each template; hand-over only where it belongs; a practical-help line after a crisis reply (owner-approved); card titles per list; a **Food and essentials drives** template or variant; the organisation lists as ready-made lists; the right template suggested after reading; installing on an existing assistant names it, asks first and records who; removing a template's additions |
| **Flows and the Scheduler** (6F full, owner-defined steps, WhatsApp Stage F) | **One engine for both kinds of flow:** conversation flows (surveys, eligibility checks, troubleshooting, lead qualification with a score, daily lessons, intake) and background flows (reminders with Confirm / Reschedule, collect reviews, after a document, win-back, product updates, onboarding drips). **A flow:** When it starts (a date on an entry or profile, a conversation event, a tag, a schedule, a webhook, a phrase) → Only if (fields, tags, history; opted-out people always left out) → steps (send, wait, ask and branch, write to a list or profile, tag, send a file, notify the team, hand over, run the assistant) → Stop when (they reply, book, say STOP, reach the end; never during a live chat with staff). **Build it:** pick a ready-made flow and answer 3–4 questions, describe it in plain words (dashboard or WhatsApp) with a preview and today's count, or edit it as a When / Only if / Then / Stop when list (the canvas editor comes in Phase 6). **Rules on every flow:** caps per person and across flows, send window, Do it or Ask me first for first sends and big batches, priority, exit words. **Before it goes live:** a test contact, a dry run ("who would get what this week"), missing templates flagged. **Watching it:** each flow's page (on/off, people in it, sent, replied, finished, its result), a person's timeline, problems in Needs you. **The Schedules screen:** follow-ups the assistant sets after a yes, reminders customers ask for, routines ("every Monday at 9, last week's summary"), announcements; smart wake-ups. **WhatsApp Flows** forms for surveys and registrations; carousels; a payment link. Templates ship flows switched off. Clinical screening waits for a clinical review |
| **Reports and staying current** | Reports per list (counts, averages, survey results, training progress, top unanswered questions, campaign outcomes); lead export to Google Sheets; re-reading pages on a schedule ("Re-read now", "last read", what changed) |
| **Anonymous responses** | Survey answers not tied to a person; a minimum group size in reports |
| **Languages** | Fixed safety and run-failed replies in Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati, Malayalam, reviewed by native speakers; those languages in the picker (Kannada for Bengaluru); no mixed scripts; templates drafted in the audience's language with a native-review flag |
| **Workspace and staff roles** (4a, 7a) | `/org/ORG.md` shared by an organisation's assistants (its real name, replacing the guess), `/agent`, `/roles`, `/knowledge`, `/updates` with expiry, `/skills` read-only; `list`, `read`, `grep` tools; page editors with history and restore; template texts move into pages. Staff by WhatsApp number or email with a role; each role's own instructions, abilities and field permissions (receptionists, volunteers, agents, HR) |
| **Ask me first and the owner on WhatsApp** (14a, 17 light) | The assistant or a flow prepares a booking, change or send; the owner or a chosen approver approves in an inbox or with a WhatsApp button and the run resumes; the owner's number can pause and resume, ask "bookings today?", teach ("closed Monday" becomes an update to confirm) and describe a flow |
| **A missed hand-over alert** | For helplines: a promised reply time and an alert when it passes |

**Gate:** a pilot organisation runs one survey and one reminder flow with real people; 40 use cases pass their starter checkups.

## 8. Phase 5 — Anyone can run it (about 3 weeks)

| Block | What's in it |
|---|---|
| **Self-serve WhatsApp** (Stage E) | Ally as a Meta Tech Provider; Embedded Signup in setup with coexistence (keep the WhatsApp Business app on the same number); each organisation pays Meta directly (Meta's price, no markup); retire the old WhatsApp number system's readers |
| **Sign-up and money** (20e) | A landing page with the benchmark on it; self-serve sign-up on Free (date with Sandeep); paying online for Pro, extra seats and a higher cap (Razorpay or Stripe), invoices; Ally admins can assign seats themselves; plan and seat limits re-set from real costs |
| **Setup on any site** (20) | Sites that block bots or are built with scripts; "Describe your business"; multi-branch ("only this branch"); setup polish (a steady step counter, real branding, names from the business, topics saved, restaurant defaults, Site visits without listings); onboarding from a template in under 10 minutes, timed |
| **Templates as files** (18, 19) | "Save as template" (pages, lists without entries, roles, abilities, checkups, flows, safety pack; never contacts, memory or conversations); share inside the organisation or by link; build by chat (a list, a role, a page, a skill or a flow as one patch); the template editor; versions and upgrades that keep the owner's changes; a public set with passing checkups; the showcase (5 assistants, public demos, one-click install) |
| **Self-host and own your data** | A profile of the assistant product alone (one compose file, seed prompts, a setup guide); bring your own model key, including an Indian-hosted or open model; full export and import of an assistant (pages, lists, templates, flows, conversations, contacts, consent records) |
| **Payments in chat** | Payment links for fees, deposits and donations; "paid" written back to the list; donors find their receipt |
| **Ready for customers, the rest** (21) | Per-template checkups in CI (a failing template is blocked); a load test; the home's needs-you list and weekly numbers |

**Gate:** someone outside Ally self-hosts in under 30 minutes; a new owner goes from website to a tested assistant on their own WhatsApp number in one sitting, without Ally's help; cost per 1,000 conversations published.

## 9. Phase 6 — Connects and shows its work (about 4 weeks)

| Block | What's in it |
|---|---|
| **The assistant canvas** (the n8n-style redesign, 16c grown) | The canvas becomes the assistant's main view (React Flow, left to right): Channels → Safety (locked, only stricter) → the assistant (purpose, instructions, knowledge, model) with its tools below (Search; each list's Look up / Add / Change with Do it / Ask me first / Never; Hand over; Remember; pages and roles) → Checks → Reply. Off nodes greyed; click a node to configure it; "+ Add" a list, a tool or a flow. **The run view, like n8n's executions:** every reply in Try it and the Inbox lights its path (numbered steps, time per step, what each found or wrote, refusals and errors in red, consent gates, the crisis verdict). **Flows drawn on the same canvas** (drag nodes, connect branches) as well as the list. A vertical version on phones |
| **Why? on every reply** (16b) | A plain-language card: the pages, records, memory, rules and abilities used, in Try it and the Inbox |
| **Connect anything** | The owner's own API tools (and OpenAPI); MCP servers as tools (chosen tools only, descriptions shown and re-checked); a webhook in and events out (Zapier and Make on day one); Google Calendar and Outlook, HubSpot and Zoho, two-way Sheets, Razorpay. Each a node on the canvas and a trigger or step in flows. Safety: ally-be makes every outside call, no internal addresses, HTTPS, timeouts, responses are data, writes start at Ask me first |
| **The full team inbox** (11) | Assignment (round robin or rules), each person's own view, labels and notes, take over and hand back, a promised reply time with an alert, a summary for whoever takes over, a team reply reachable after New chat |
| **UI1, a chat that feels alive** (`chunk-ui1.md`) | The welcome (cover, logo, one line, hours / location / contact cards, suggested and ability chips); cards for list entries (photo, price, details, a button), up to 6 in a row; media (images, videos, documents) only from cited sources; contact cards; bubbles, avatars, smooth streaming; sign-out for signed-in visitors; dark mode following the device; empty, loading, error and offline states; accessibility; owners control cover, colours, cards and questions in Share → Page with a phone and desktop preview |
| **Lists v2, what pilots asked for** | From: validation on every field, required fields, image and file fields, relations shown by name, stored recurrence, waitlists, a range rule (overlapping stays), CSV that round-trips, undo for definition changes, an audit view per entry, `options_from`, multi-select; booking from rules with time zones, buffers, staff calendars and reschedule rules; `check_rules` (eligibility and pricing); one rules engine for find, create and update with a property-based test suite; versioned templates |
| **WhatsApp calling and voice agents** | Later in the phase |

## 10. Phase 7 — Remembers and learns, with approval (after that)

| Block | What's in it |
|---|---|
| **Memory in full and people** (8, 7) | A profile per person with fixed sections, each line sourced and dated; the nightly tidy; the agent's notebook; memory across channels; custom profile fields; relations (parent ↔ child, lead ↔ assigned agent, employee ↔ manager); segments; the People page |
| **History** (16a) | Search past chats, summaries, `recall` ("what did we discuss last month?"), unanswered topics grouped |
| **Learning with approval** (8L) | Declines, corrections and hand-overs become proposals (an answer, a page edit, a skill) the owner approves; approved items become checkups |
| **Trust checks** (15) | The Never check on every reply; learning mode (unsure replies as drafts in an assistant's first week); the commitment check (prices, discounts and dates against what the owner allowed); the promise ledger ("we'll call you back" becomes a task with an owner and a deadline) |
| **Media in, beyond WhatsApp** (9) | Photos and documents into fields (cards, invoices, IDs) with masking; sensitive images dropped after extraction; customer uploads with medical-image safety; optional voice replies |
| **More use cases and channels** | OTP identity for "show my records"; live queue status; voice and phone (LiveKit, as in ally-ai-learn); courses and daily lessons on flows; intake and screening forms after clinical review; the owner's 9 pm digest; Instagram, Messenger, Slack and Teams for staff assistants; click-to-WhatsApp ads tracking beyond the source |

## 11. Later (v3)

Fully automatic learning for areas the owner trusts · earned autonomy (draft → automatic on measured staff acceptance) · two doors (`workspace.yaml` and an SDK editing the same assistant) · the public template gallery and skills store · Ally as an MCP server · the proof page · the open-source release (MIT already) · the agent writing to `/scratch`.

## 12. Cut or parked

Board and calendar views, bulk edit and saved filters in lists · a dark home (the dashboard) · custom domains and multi-page sites · share a private page by mobile number · the 12-assistant showcase (make 5) · **WhatsApp commerce:** catalogue and cart, abandoned-cart recovery, Shopify and WooCommerce sync · an ads manager (only the ad source is captured) · TikTok inboxes · payments beyond a payment link · large-enterprise deals · token allowances (replaced by the spend cap, CR3).

## 13. Gates

| Gate | What must be true | Where |
|---|---|---|
| **Launch** (G1, G1b, G2) | The launch gate in 4 (1.7); one internal and one pilot assistant on public links; a pilot clinic books from lists and the assistant remembers returning patients; Forget and masking end to end; no health data in logs | Phase 1 |
| **WhatsApp reaches people** | Stage A, B, C gates in 5 | Phase 2 |
| **Provably right** | Claim 1 or 2 shown on the benchmark | Phase 3 |
| **Organisations** | A pilot organisation runs a survey and a reminder flow with real people; 40 use cases pass | Phase 4 |
| **Anyone can run it** (G5, G6) | Self-host in under 30 minutes; a new owner on their own number unaided; onboarding under 10 minutes; templates built and shared by a non-Ally user; privacy, CI evals, the spend cap, v1 removed | Phase 5 |
| **Team-ready** (G3) | A pilot with staff uses the team inbox and rich messages; the bubble on one website | Phases 2, 6 |
| **Trusted, owner-run** (G4) | Approvals, the Never check, history and Why? in use; the owner runs it on WhatsApp | Phases 4, 6, 7 |
| **Agent core** (G2a) | Remembers a returning person across two channels; learning proposals handled by a real owner | Phase 7 |

## 14. Decisions log

| Date | Decision |
|---|---|
| 16 Nov | Owners only, no view of all assistants; login with no sign-up; custom logins (then platform admins with only the WhatsApp-bot toggle; became a limited role in CR1); share by mobile number dropped |
| 18 Nov | One Claude Code session at a time (a second only in its own worktree, never sharing the Docker stack) |
| 19 Nov | Order: accounts → templates → the chat → correct responses → lists and templates v2. Credits redesigned as plans and seats: Free 3 published assistants, Pro 20; 5 included seats per assistant for invited people; extra Basic or Premium seats renewing on their own dates; plans belong to chatbot creators only; Ally assigns plans and seats; seats strict; limits in messages, never dollars to customers; costs tracked internally per model with versioned prices; Models screen to add, update, retire and delete models |
| 19 Nov | H1 hotfix before anything else; crisis check never holds a reply more than 6 s; consent for every write in a later turn; reasoning effort "low" as the code default |
| 19 Nov | T1: the six organisation templates match the sign-in page, then 11 business templates |
| 20 Nov | CR3: a monthly spend cap per creator in dollars replaces token allowances; owners see only their usage against the cap |
| 20 Nov | Invite-only launch first; open sign-up later; organisations first among pilots |
| 20 Nov | Q4 then RC1, one at a time; the use-case suite built first, every fix measured on it |
| 22 Nov | Book by tap replaces T2 before launch; T2's three urgent items into Q4; T2 after launch |
| 22 Nov | Booking for someone else: yes, their name said back in the question |
| 23 Nov | Grader fixed first; prompt texts approved with edits (conflicts named, Young people for schools, Hinglish crisis line); template-written crisis numbers unconfirmed until the owner confirms |
| 23 Nov | WhatsApp: close the outbound gap straight after launch (Stages A–D), beat competitors after the broadcast lands, skip commerce |
| 23 Nov | Demos are template-led, with fictional organisations |
| 23 Nov (evening) | **Fast track:** Q4 is the last block before launch. Part 1 (safety, publishing, answers and search) merges once the live-path must-pass cases pass; part 2 adds only the must-dos (G+9 "unchanged", H5–H10, H12, G2, C16, B4, B7, the setup pool fix, G+15, A3). BT1, speed tuning (D, stop 3), answer quality to 85% and Q4's polish items move after launch. RC1 waits until after this launch: the first launch is internal (Ally's own team and invited testers), so erasure requests are handled by hand and errors watched in the logs. In-data at 62–75% is accepted for an internal launch watched daily. Internal launch about Fri 27 Nov; RC1 before any outside organisation's real users |
| Open | The speed gate for launch (suggested: status under 2 s, median under 12 s, first words under 8 s); reasoning effort "minimal" (measured in Q4); whose Meta app pilots' numbers sit on |

## 15. Follow-ups and known debt

- Replace the `gpt-4o-mini` code defaults (crisis check, translate) before OpenAI retires it on 14 Jan 2027.
- Point the old analytics cost charts at the Models price list; meter the embedding calls outside assistants (Context Library, roadmap, reference documents) and Sarvam, the TTS round-trip eval and the debrief toolbox.
- A retried crisis check drops its tokens as a duplicate (small undercount).
- Token tables kept but unused since CR3; drop later.
- Run the WhatsApp-numbers production SQL from the report; retire its readers (Phase 5).
- Hindi strings marked "needs review"; Tamil and Bengali hand-over lines stay English until review.
- Remove old worktrees (`ally-platform-q3d`, `ally-platform-retest`, `ally-platform-h1`, `ally-platform-t1`).
- Delete local test data and the saved local owner token after Q4.

## 16. Outside the code (Shehbaz)

| What | By |
|---|---|
| Rename or unpublish Vandrevala's `/b/unchanged` page | Now |
| Enter the Free and Pro cap amounts; tick the launch checklist on production | Now |
| Meta business verification ✅ (verified); the Tech Provider application | Start now |
| WhatsApp Stage 0: number and webhook ✅; a payment method in rupees, 5 templates submitted, two-factor for everyone | This week |
| Decide the speed gate and "minimal" reasoning (Q4 stops for it) | During Q4 |
| Pick the two pilots (one an organisation), a contact at each, and the first invite list | Before the gate round |
| Decide whose Meta app the pilots' numbers sit on until self-serve | Before launch |
| An opt-in policy: how each pilot's contacts agreed to be messaged, in writing, before any import | Before Phase 2 |
| Read Meta's messaging policies for health and mental-health content | Before the first health campaign |
| Confirm rupee billing for each pilot's number with Meta | Before 31 Dec |
| A clinical reviewer (crisis wording, packs, screening) and native speakers (six languages, Hindi strings, template translations) | Phases 3 and 4 |
| The sign-up date with Sandeep | Phase 5 |
| Apply for digital-public-good listing; one reference organisation per organisation template | From Phase 3 |
| Reference screenshots of chats you like | Before UI1 |
| Rehearse the demos once Q4 is deployed | Before client demos |

## 17. How every block runs

- One Claude Code session at a time, its own branch, a PR per block; plan mode first; stops only where the brief says (texts, designs, decisions).
- Starts from the use-case suite and the saved suites, measured before and after (3 runs for final numbers).
- Prompt texts approved, then published to production's Skills Store before deploying.
- Production is read-only for sessions; eval tokens belong to a team member; exports from production are never committed and are deleted after use.
- Never `--no-verify`; never run live evals alongside Docker Playwright; Postgres specs run locally until CI runs them.
- A production round at the end of each phase, compared with the last; test data removed after.
- Anything Serious blocks; "fix before customers" goes into the next fix block; polish waits.
- Docs stay few: one plan (this file), one brief per active block, one results file per round in `evals/`.

## 18. Which docs are current

**Current:** this file · `chunk-q4.md`, `chunk-bt1.md`, `chunk-rc1.md`, `chunk-t2.md`, `chunk-ui1.md` · `EVAL-USECASES.md` · `FIXES-22NOV.md` · `WHATSAPP-GAPS-PLAN.md` · the eval reports of 20–22 Nov · the demo playbook doc · `CONTEXT.md`, `LAUNCH-CHECKLIST.md`, `USER-GUIDE.md` and the chunk notes.

**Superseded by this file** (kept for history): `FINAL-PLAN.md`, `MASTER-PLAN.md`, `7-DAY-PLAN.md`, `NEXT-STEPS-18NOV.md`, `NEXT-STEPS-20NOV.md`, `10X-PLAN.md`, `ROADMAP-NEXT.md`, `STATUS.md`, `ROUND5-PLAN.md`.
