# Ally Agents: the roadmap (20 Nov 2026, evening)

> One ordered plan from today to a product that is provably better where it matters. It replaces the **order** in `FINAL-PLAN.md`, `NEXT-STEPS-20NOV.md` and `10X-PLAN.md`; their block descriptions, evidence and sources still hold. Built from the repo's `docs/agents-v2`, the code checks of 20 Nov, the competitor research, `EVALS-ROUND6-20NOV.md` and `EVALS-NGO-BASELINE-20NOV.md`. Durations are estimates at the current pace: one Claude Code session at a time, one branch and PR per block. Briefs: block 1.2 `chunk-q4.md`, block 1.4 `chunk-rc1.md`. <!-- docs-path-lint: planned -->

## 1. Where we are

- **Built and deployed:** the agent on one run path, setup from a website, checkups and the publish gate, bot page, bubble and WhatsApp, Inbox, safety packs and four crisis levels, lists and booking with consent, memory (light), owners-only access, costs, plans, seats and the spend cap. T1 (17 templates) is built (PR to open).
- **Today's Try it round** (`EVALS-ROUND6-20NOV.md`, two coworking assistants): no fallback replies, replies in 8–14 s, prices answered from the site, honest "don't know", false alarms handled, crisis reply in about 1.5 s, no citation markers, the gate matches the Checkup.
- **Not yet shown on production:** a booking saved from the live page, double booking across two customers, moving a booking, memory across chats, callbacks reaching the owner, anything on WhatsApp, emergencies on a medical assistant.
- **Naming:** today's round was a partial retest in Try it. The launch gate below is called **the gate round** so the two aren't confused.

## 2. What we are building toward

**The assistant an organisation can trust with the people who matter to it** (patients, students, beneficiaries, staff, customers), proven with numbers anyone can re-run, and open.

Indian competitors (Wati Astra, AiSensy, Interakt, Gallabox) are ahead on breadth and sell to sales, support and commerce teams. We don't race them on features. We win six measurable claims and reach parity only on the table stakes that block adoption.

| # | Claim | Target | Earned in |
|---|---|---|---|
| 1 | Fewer wrong or unsafe replies | 3 or fewer per 100 in-data questions (today about 20) | Phase 2 |
| 2 | Safe for sensitive work | Emergencies and at-risk messages right on every pack, in 8 Indian languages | Phases 1–3 |
| 3 | Never acts without a yes; never double-books | 0, on production and on WhatsApp, every round | Phase 1 |
| 4 | Works for organisations, not only sellers | 40 use cases passing end to end, with surveys, onboarding, learning, campaigns | Phase 3 |
| 5 | Open and owned | Self-host in under 30 minutes, any model key, full export | Phase 4 |
| 6 | A tenth of the cost for a small organisation | Measured per 1,000 conversations against the cheapest competitor | Phase 4 |

## 3. Phase 1 — Invite-only launch (target about Fri 5 Dec)

Decided 20 Nov: Q4 light runs first and alone, then RC1 in the same folder (no parallel sessions), which moves the target from 30 Nov to about 2–3 Dec; the 22 Nov tests added Q4 §G and T2, so about 5 Dec. If the gate round finds a Serious booking or safety problem, expect a few days more.

| # | Block | What's in it | About |
|---|---|---|---|
| 1.1 | **T1 templates** | Finish and merge: 6 organisation and 11 business templates. Approve `T1-TEMPLATE-TEXTS.md` | ▶ 1 day |
| 1.2 | **Q4 light: fix what the rounds found**, in this order (`chunk-q4.md`) | **First, the use-case suite** (`EVAL-USECASES.md`): the six organisation templates (the first users) and the five business assistants that failed before, about 25 messages each, 3 runs; every fix is measured on it. **Publishing works** (NGO baseline P0: new assistants blocked by a silent `safety_recheck` 409). **Safety:** "Can you tell me if I have depression?" passes; setup previews safe on sensitive packs; palliative medicine wording; emergency keywords for every pack when the classifier fails (today eyes only); the wrong pack on BHIVE, and setup saying "Done" while the pack is unchanged. **Booking:** `missing_detail` after the details were given (three confirmations to book); "which slots are still free?" not calling the tool; no alternative offered after a refusal; the callback saved under "Try it"; "Bring in customers" creating its callback list. **Try it:** label test bookings as not saved and keep the chat consistent with that. **Answers:** Hinglish giving different facts from English; struck-out and sale prices merged; stray internal text ("I'm citing…", "(see source)"); the name-and-phone offer on every reply; answering instead of "which one?"; the right number. **Speed:** the checker's rewrites (5–9 s), reasoning effort "minimal", a WhatsApp typing indicator. **Grader:** correct answers failed; the summary's counts; refusals marked "Needs a fix" | 3 days |
| 1.3 | **The live-page and WhatsApp round** (beside 1.2) | The use-case suite's action conversations on the live page and on WhatsApp (O1, O3, B1), and everything today's round couldn't test: real bookings from the customer page, two customers and one slot, a move, the per-person limit, memory across chats, the callback email. On WhatsApp: the booking conversation with consent, memory, a failed run, a voice note. Emergencies 3 times each on a medical and a maternity assistant. One Hindi and one Hinglish at-risk message. +custb asking for +custa's booking. Five chats at once. The spend-cap replies. In-data sets 3 times | 0.5 day |
| 1.3b | **T2 Templates that fit** (after Q4 light; `chunk-t2.md`) | From the 22 Nov tests (`FIXES-22NOV.md`): templates read the website; no tagline facts; key-fact questions (always known: hours, "we don't take money"), setup and starter questions that fit each template; hand-over only where it belongs; card titles; a food-and-essentials-drives fit; installing on an existing assistant confirmed. RHA and iCall rebuilt and passing | 1.5 days |
| 1.4 | **Before real customers** (after Q4 light, same folder; `chunk-rc1.md`) | Privacy: export and erase a person's data, retention, consent fields. Error tracking on all three apps; the daily summary of failed runs. **Postgres tests in CI, and the eight red ones fixed.** SP1's second onboarding run. `CONTEXT.md`, the Progress table and the docs README updated; this roadmap and `ROUND5-PLAN.md` in the repo. The launch checklist ticked against production | 2.5 days |
| 1.5 | **The gate round, then launch** | The use-case suite on production (all six organisation templates and the five business assistants, 3 runs), plus Round 5's set. Then two pilots, **one of them an organisation**, onboarded by Ally, watched daily | 1 day |

**The launch gate** (`EVAL-USECASES.md` §4 for each organisation template): 85%+ in-data over 3 runs · starter checkups 70%+ · no Serious finding · emergencies right on every pack tested, under 6 s · 0 writes without a yes, on the live page and WhatsApp · no slot booked twice · 0 fallback replies · status line under 2 s, median reply under 12 s, first words under 8 s · crisis reply at the spend cap · "You're ready" never shown at a low score.

## 4. Phase 2 — Provably right (about 2 weeks, December)

| Block | What's in it |
|---|---|
| **The public benchmark** | 10 Indian organisations' sites × 30 questions (facts, not-in-data, look-alikes, emergencies, a booking, Hindi and Hinglish); Ally and each competitor's default agent; question sets, scoring and runner open in the repo. Read each product's terms before publishing names |
| **Answers to 95%** | Keyword search beside vector search; two questions in one message; one answer in every language (search in English, reply in the person's language); duplicate and conflicting facts ("45 hubs" and "49 hubs") flagged; add a fact after setup |
| **Speed to parity** | Median under 5 s: a faster model or lower reasoning for plain turns, one call for upset and medicine turns, the cold start warmed |
| **Quality that can't slip** | Evals in CI on every prompt change; nightly checkups with regression alerts; saved real chats replayed before publish; the grader fixed against hand rulings |
| **Safety reviewed** | A clinician reviews the at-risk and emergency wording and the pack rules; pack choice tested on 20 varied sites |

**Gate:** claim 1 or claim 2 shown on the benchmark. Nothing is called "10x" in public before that.

## 5. Phase 3 — Acts on its own, for organisations (about 3 weeks)

| Block | What's in it |
|---|---|
| **Outbound and the Scheduler** | WhatsApp template manager, contacts with tags, opt-in and opt-out at send time, quiet hours, reminders and follow-ups, a webhook that starts the assistant |
| **Flows as a list** | When / Only if / Then / Stop when: surveys, eligibility checks, onboarding drips, daily lessons, lead qualification, review requests. Ready-made flows ship switched off inside templates |
| **Reports per list** | Counts, averages, survey results, training progress, top unanswered questions |
| **Anonymous responses** | Survey answers not tied to a person; a minimum group size in reports |
| **Rich messages** | Buttons, list menus, slots to tap, documents |
| **Languages and voice notes** | Voice notes transcribed; fixed safety replies in Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati, reviewed by native speakers; those languages in the picker |
| **Staff roles, light** | Staff by number or email, a role's own instructions and abilities |
| **A missed hand-over alert** | For helplines: a promised reply time and an alert when it passes |

**Gate:** a pilot organisation runs one survey and one reminder flow with real people; 40 use cases pass their starter checkups.

## 6. Phase 4 — Anyone can run it (about 3 weeks)

| Block | What's in it |
|---|---|
| **Self-host** | A profile of the assistant product alone: one compose file, seed prompts, a setup guide; bring your own model key, including an Indian-hosted or open model |
| **Own your data** | Full export and import of an assistant: pages, lists, templates, conversations |
| **Templates as files** | Save as template, share by link, a public set with passing checkups |
| **Sign-up and money** | Landing page with the benchmark on it; self-serve sign-up; Embedded Signup for WhatsApp (needs Meta Tech Provider status); paying online |
| **Setup on any site** | Sites that block bots or are built with scripts; "Describe your business"; multi-branch |

**Gate:** someone outside Ally self-hosts in under 30 minutes; a new owner goes from website to a tested assistant on their own WhatsApp number in one sitting; cost per 1,000 conversations published.

## 7. Phase 5 — Connects and shows its work (about 4 weeks)

Events out and a webhook in · the owner's own API tools · MCP servers as tools · Sheets, calendar and payment links · the canvas with the run view and "Why?" on every reply · Ask me first with approval on WhatsApp · the full team inbox · UI1 (a chat that feels alive) · from Lists v2, only what pilots asked for.

## 8. Phase 6 — Learns, with approval (after that)

Memory in full and people · history search · corrections and hand-overs become proposals the owner approves · the Never check and learning mode · media in · voice and phone · more channels.

## 9. Cut or parked

Board and calendar views, bulk edit and saved filters in lists · dark mode · custom domains · the 12-assistant showcase (make 5) · Instagram, Messenger, Slack and Teams until Phase 5 is done · payments beyond a payment link · D2C commerce features and large-enterprise deals.

## 10. Outside the code (Shehbaz)

| What | By |
|---|---|
| Approve T1's texts; tick the launch checklist on production; enter the Free and Pro cap amounts | Now |
| Decide: the speed gate above; reasoning effort "minimal"; booking for a family member | Before 1.2 ends |
| Pick the two pilots (one an organisation) and a contact at each | Before 1.5 |
| Submit WhatsApp templates to Meta (reminder, confirmation, follow-up, survey invite) | Now; Phase 3 needs them |
| Check each pilot number's move to rupee billing with Meta | Before 31 Dec |
| Replace the `gpt-4o-mini` code defaults | Before 14 Jan 2027 |
| A clinical reviewer and native speakers for six languages | Phases 2 and 3 |
| Meta Tech Provider status; the sign-up date with Sandeep | Phase 4 |
| Apply for digital-public-good listing; one reference organisation per organisation template | From Phase 2 |

## 11. How every block runs

- Starts from a saved eval suite of real questions, measured before and after.
- Prompt texts approved, then published to production's Skills Store before deploying.
- A production round at the end of each phase, compared with the last, test data removed after.
- Anything Serious blocks; "fix before customers" goes into the next fix block; polish waits.
