# Agents v2 — build chunks (revised 6 Nov 2026: modular building blocks)

Read `CONTEXT.md`, `BUILDING-BLOCKS.md` and `SLICE-1.md` first. Product spec: `agents-v2-spec.md`; where it puts the scheduler, flows or the self-learning loop in v2, **this file wins: those three moved to v3.** Engineering detail: `three-stage-plan.md`. What exists today: `stage1-build.md`.

## How to use this file

- Each chunk is sized for **one Claude Code loop**: one branch, roughly 2–4 days, one PR.
- Each chunk **ships dark**, behind the per-bot runtime, Agent mode or a feature flag.
- Each chunk ends with **"You test"** checks. Don't start the next chunk until they pass.
- Give Claude Code one chunk brief at a time. Ask for the next brief once a chunk passes.
- Repos: **ally-ai** (Python, LangGraph), **ally-be** (TypeScript, migrations, WhatsApp, engine), **ally-web** (admin dashboard).

## Rules that hold for every chunk

1. Don't change v1 behaviour. Every new path is opt-in per bot.
2. Graph decides, ally-be executes. ally-ai never writes to the database or sends messages; it calls the ally-be gateway.
3. Every send and every write has an idempotency key. A retry must never message a person twice or create a record twice.
4. Safety only tightens. Crisis, consent, STOP and the grounding checks stay as they are, or stricter.
5. **Build blocks, not industries.** Every feature is a generic block, field type, setting or template (`BUILDING-BLOCKS.md`). No code that only makes sense for one kind of business.
6. Each chunk adds tests, leaves CI and lint green, and ends with `CHUNK-NN-NOTES.md`.
7. Each chunk that changes what the agent says or does adds conversation eval cases and runs them: 0 hard fails (an uncited fact, medical advice, an out-of-scope answer, unsourced contact details, markdown in a reply, a write that broke a constraint).

## Progress

| Chunk | Status |
|---|---|
| 1 LangGraph runtime with parity | ✅ merged |
| 2 Runtime switch, shadow, fallback | ✅ merged |
| 3a Conversational agent | ✅ merged |
| 3r Review and refactor | ✅ merged |
| Manual test (Sunrise Mind demo bot) | ✅ done |
| 3d Every bot on v2 while the platform switch is on | ✅ (see its notes) |
| 3c Streaming and typing | ✅ merged (#232) |
| **Slice 1 (website → shareable bot)** | One branch, `feat/agents-v2-chunk-12-shared-store` (see `SLICE-1.md`) |
| 12 Shared store and contact identity | ✅ built on the slice 1 branch |
| 12b Bot page | ✅ built on the slice 1 branch (see its notes) |
| 20a-1 Agent-first onboarding: start → publish | ✅ built on the slice 1 branch (see its notes) |
| 20d Design pass: one screen at a time, brand and images | ▶ next |
| 20a-2 Checkup, try it, change by chat (+ `chunk-20a2-additions.md`) | after 20d |
| 15a Crisis classifier v2 | after 20a-2 |
| 20e Landing page | after 15a |
| Stages 2–8 | Not started (see Stages below) |

**Learned so far:**
- The agent decides every step itself; tools are modules; grounding is enforced in code (`agent_check`).
- Contact details must come from a source; persona text isn't one.
- The organisation name must be explicit (ORG.md, chunk 4).
- Production needs `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low`.
- **Open: the crisis classifier** flags harmless follow-ups ("and what if I miss a day?") because it sees only the latest message. Deferred until the agent is tested end to end; must be fixed before any public bot page (gate G1b). Plan: give it recent turns, add benign look-alikes to the prompt, and require zero missed crises on a crisis eval set.
- Cold start: the first question after a restart took 19.6 s. Add a warm-up at startup before G1.

## Stages (8 Nov 2026)

The stages replace the earlier phases, "Moved to v3" and "Order and timing". The chunk descriptions in the Phase sections below still hold unless "Changes to chunks" says otherwise. The human-readable version is the Claude Doc "Agents v2: The Complete Plan".

| Stage | Version | Chunks, in order | Result | Target | Gate |
|---|---|---|---|---|---|
| 1 First version live | v2.0 | 20a-1 finish → 20d → 20a-2 (+ `chunk-20a2-additions.md`) → 15a → 20e | Website → tested, branded assistant → shareable link and landing page | Late Nov 2026 | G1 + G1b |
| 2 Agent core | v2.1 | 3b → 4 → 7 → 8 → 16a → 8L | Workspace (filesystem agent), profiles, managed memory, history search, owner-approved learning | Late Dec 2026 | G2a (new) |
| 3 Quality | v2.2 | Q1 → Q2 | Checkups and the live scorecard | Mid Jan 2027 | — |
| 4 Building blocks | v2.3 | 5 → 6 → 6F → 9 | Owner's own lists and tools, light follow-ups, media and voice | Early Feb 2027 | G2 |
| 5 Templates | v2.4 | 18 → 19 → 20 | Save, share and install assistants (booking, reviews, leads…) | Late Feb 2027 | G5 |
| 6 Conversations and team | v2.5 | 10 → 11 → 13 | Buttons and media, team inbox, website widget | Mid Mar 2027 | G3 |
| 7 Trust and the owner | v2.6 | 14 → 15 → 16b → 17 | Approvals, Never check, Why?, owner on WhatsApp | Late Mar 2027 | G4 |
| 8 Ready for customers | v2.7 | 21 | Privacy, CI evals, cost cap, rollout | Early Apr 2027 | G6 |

### Changes to chunks

- **4 Workspace (was "Pages and the context workspace")** moves to Stage 2, before memory. The tree gains `/skills/*`. Tools: `list`, `read`, `grep`, `search_knowledge`, and `write` only to `/contacts/<id>/USER.md`, the notebook and `/scratch`. Stage 1's learned facts and Owner notes migrate into `/knowledge` and `/org`.
- **8 Memory** adds managed memory: USER.md with fixed sections (preferences, context, open items, relations), each line sourced and dated; new facts update their line; a nightly tidy (merge duplicates, close finished items, expire short-lived ones, newest wins on conflict); a per-run budget (summary + relevant lines); health packs store only non-clinical details by default.
- **16 splits:** 16a History search and summaries (Stage 2); 16b "Why?" (Stage 7).
- **8L Learns from conversations (new, Stage 2):** proposes answers, corrections to `/knowledge` and `/org`, and skills in `/skills`; the owner approves each; approved items also become checkups. Fully automatic learning stays in v3.
- **6F Follow-ups, light (new, Stage 4, brought in from v3):** triggers on a list change or a time offset send an approved WhatsApp template, bot page message or email, with quiet hours, once per person and opt-out. Powers booking reminders and review collection. The visual flow builder stays in v3.
- **Gate G2a (new):** a pilot bot remembers a returning person across two channels; Forget works end to end; no clinical details in memory or logs; learning proposals approved or rejected by a real owner.
- **Gate G1** (ops: checkpoint DB, retention, reasoning effort, prompts published) now applies before Stage 1 goes live, not after 3b.

## Phase A — Engine

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 1 | ✅ **LangGraph runtime with parity** | ally-ai | `/agent/run` answers like v1 |
| 2 | ✅ **Runtime switch** (v1, Shadow, v2), fallback, kill switch, run id on messages | ally-be, ally-web | Flip a bot to v2 and back |
| 3a | ✅ **Conversational agent:** the agent node, tool registry, `search_knowledge` as a tool, history, persona, grounding checks | all three | Natural small talk; cited answers; out-of-scope declines |
| 3r | ✅ **Review and refactor** of 1–3a | all three | Same behaviour, cleaner code |
| 3c | **Streaming and typing:** live status and steps, checked reply text revealed progressively, a hard run timeout, a WhatsApp typing indicator | all three | Preview shows the agent working; crisis text never streams |
| 3b | **Tool gateway:** internal routes with a per-run token, idempotency, `tool_runs`, a per-bot tool allow-list | ally-be, ally-ai | Every tool call is logged; a replay returns the stored result; a disallowed tool is refused |

## Quality — Checkups and the live scorecard (right after slice 1)

In the product these are called **Checkups** (the test questions a bot must pass) and the **Scorecard** (how it's doing with real people). Internally they reuse the eval machinery.

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| Q1 | **Checkups.** Test questions per bot, each with what a good answer must do: *answer and cite* (optionally which document, and key facts that must appear), *decline politely*, *ask a clarifying question*, *hand over*, *crisis reply only*, and *must not say* (phrases or claims). **Generated automatically:** from the bot's documents and pages (like 20a's readiness check), from its safety pack (crisis and medical probes), and from real conversations (a declined or thumbs-down question becomes a suggested checkup). Owners **add, edit, delete, pause and group** them, and can promote any real conversation turn to a checkup in one click. **Runs:** on demand, automatically after any change to the bot (persona, documents, pages, settings), and nightly. Results per checkup: pass or fail, the reply, its sources, why it failed (automatic checks first, then an AI grader for meaning). History per run, with "this got worse after Tuesday's change" flags and a link to the change. Cost cap per bot per day | all three | Open a bot → Checkups: about 20 generated; add one by hand; edit what a good answer must include; change the persona and see the checkups re-run and flag a regression; a declined real question appears as a suggested checkup |
| Q2 | **Live scorecard.** How the bot is doing with real people, updated as conversations happen (from the shared store, chunk 12): conversations and people today and this week; **answered with sources**, **declined** and **clarified** as shares; top unanswered topics; crisis replies; handovers (later); median response time; **thumbs up or down** on bot-page replies, with an optional comment; checkup pass rate over time; per channel (WhatsApp, bot page). Each number opens the conversations behind it. Alerts when the answered share or the checkup pass rate drops below a threshold the owner sets | all three | Chat on the bot page and watch today's numbers move within a minute; give a thumbs down and see it in the scorecard and as a suggested checkup; click "declined" and land on those conversations |

Templates (chunk 18) ship with their checkups, and the evals in CI (chunk 21) run every template's checkups.

## Phase B — Building blocks

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 4 | **Pages and the context workspace.** Versioned Markdown pages in a virtual file tree: `/org` (with the explicit organisation name), `/agent`, `/roles/*` always loaded within a size budget; `/knowledge/*` and `/updates/*` (with expiry) read on demand. Tools: `list`, `read` (whole sections), `grep`; `search_knowledge` stays. Page editor with history and restore; an Updates screen. **Page visibility by role**, enforced in retrieval and `read` | all three | Edit AGENT.md and the next reply follows it; restore brings back the old version; an expired update is ignored; a managers-only page is never read for an employee |
| 5 | **Collections core.** User-defined collections: field types, constraints (`unique`, `capacity` with a waitlist, `limit_per_person`, status transitions), **recurrence** (every Tuesday until a date), views (table, board, calendar), CSV import and export, per-collection and per-field permissions including `never_store`, `masked` and retention. Rules tables | ally-be, ally-web | Build "Slots" and "Appointments" from scratch in the dashboard; a taken slot is refused; the 21st person in a class of 20 is waitlisted; a weekly booking creates one record per week |
| 6 | **Generated collection tools.** `find_*` (filters, ranges, sort, count and sum), `create_*`, `update_*` and `check_rules`, generated from each collection's schema and exposed through the gateway. Constraint errors come back as plain reasons; results are citable, so grounding covers them | ally-ai, ally-be | "2BHK in Baner under 85 lakh" filters listings; "book Thursday 11:15" creates a record; "slot taken" is explained with alternatives; eligibility comes from `check_rules` |
| 7 | **People and relations.** A channel-agnostic contact identity (WhatsApp now, web later); configurable profile fields; **relations** (parent ↔ students, employee ↔ manager, lead ↔ assigned agent, contact ↔ records); team members with roles; groups and segments; profile panel in Conversations | all three | A parent sees each child's records; a lead shows its assigned agent; profile fields are editable by staff |
| 8 | **Memory: profiles and the agent's notebook.** Hermes-style memory you can read. **USER.md per contact** (preferences, context, open items, each with a source and date), written by `remember`, read by `recall`; the **agent's notebook** for business-level notes (`note`); memory settings per bot (what to remember, never store, how long to keep); view, edit and **Forget** in the dashboard; memory loaded into every run within a budget; memory writes visible in the run's steps | all three | Tell the bot "I prefer evenings" and next week it offers evening slots; the profile shows that fact with its source; Forget removes it and the next run doesn't know it; a "never store" item is refused |
| 9 | **Media in and voice.** Files on a person or record; read photos and documents into fields (cards, invoices, IDs) with masking; **voice notes transcribed** with language detection before the agent runs; **optional voice replies** in the user's language; sensitive images dropped after extraction | all three | A business-card photo fills fields with sources; a Marathi voice note is answered (in voice too, if on); an Aadhaar photo keeps only the last 4 digits |

## Phase C — Conversations

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 10 | **Messages out: documents, media and interactive.** Replies can carry reply buttons, list menus, images with captions, documents and location pins, falling back to text where a channel can't show them; send a document attached to a person or record, with delivery tracking; templates outside the 24-hour window | all three | "Morning or Evening batch" arrives as buttons; three listings arrive as photos; an invoice PDF is delivered and tracked |
| 11 | **Team inbox and handover.** Staff see live conversations, **take over, reply from the dashboard, and hand back** to the bot; assignment (round robin or rules); each agent sees their own; handover with a promised reply time and an alert when it's missed; a conversation summary for whoever takes over | all three | Hand over, reply from the dashboard, hand back, and the bot continues with context; a missed promise alerts |
| 12 | **Shared conversation store.** Channel-agnostic conversations and messages, WhatsApp data backfilled, writes going to both during the switch | ally-be | WhatsApp history unchanged; new messages land in the shared tables |
| 12b | **Bot page: a shareable chat link.** A hosted, full-page chat for the bot at its own link (for example `chat.<domain>/b/<slug>`), using the `web` connector with streaming. **Branding:** logo, colours, cover text, suggested questions, the disclaimer. **Access:** public, organisation only, or specific people (email or phone list, with a one-time code), reusing the bot's access list. **Pre-chat questions** (Typeform-like): up to about 8 fields (text, email, phone, choice, date, a consent checkbox) asked one at a time before the chat starts. Answers are saved on the conversation and mapped to profile fields once People lands (chunk 7). **Protection:** rate limits per visitor, a bot check on public links, and a per-bot daily cap. Analytics: visits, starts and completed intakes | all three | Share a public link and chat from a phone browser with no login; a private link asks for a code first; the pre-chat questions appear one by one, and their answers show on the conversation; changing the colours or the suggested questions shows on the next load |
| 13 | **Website chat widget.** A small embed script that opens the bot page (12b) as a bubble on any website, reusing its branding, access and pre-chat questions; plus page rules and branding, page rules, Continue on WhatsApp with **memory and history carried over** | all three | Chat on a test page, continue on WhatsApp, and the agent remembers the earlier chat |

## Phase D — Trust, history and the owner

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 14 | **Abilities and approvals.** Every built-in and generated ability gets Do it / Ask me first / Never with an **approver** (owner, the assigned person, or a related person such as the manager); a LangGraph `interrupt` pauses the run; approvals inbox on the web and **approve/deny buttons on WhatsApp**; the run resumes in the same conversation | all three | "Cancel within 24 hours" pauses; the approver taps Approve on WhatsApp; the bot confirms to the patient |
| 15 | **Never check and learning mode.** Every reply is checked against the bot's Never list before sending; learning mode sends unsure replies to the owner as drafts first | ally-ai, ally-be | A reply breaking a Never rule is blocked and logged; in learning mode the owner approves drafts |
| 15a | **Crisis classifier v2** (slice 1). The crisis check gets the recent turns as context; its prompt gains benign look-alikes ("what if I miss a day", "I'm done for today", "dead tired"); a crisis eval set (about 30 real phrasings in English, Hindi and Hinglish, including indirect ones, plus about 30 look-alikes); ship only with **zero missed crises** and fewer false alarms; published as a new prompt version after review | ally-ai, ally-be | The crisis eval shows 0 misses and fewer false alarms than v1; "and what if I miss a day?" after a streaks question is no longer a crisis |
| 16 | **History: search, summaries, topics and "Why?".** Every conversation searchable, with a summary; the agent can `search_history` ("what did we discuss last month?"); unanswered and handed-over questions grouped into topics; a plain-language "Why?" card on every reply (pages, records, memory, rules and abilities used) | all three | Search "refund" across chats; the bot recalls an earlier conversation when asked; Why? matches the run |
| 17 | **Owner on WhatsApp (manager mode).** The owner's number is recognised: **teach** ("we're closed Monday" becomes a proposed Update or page edit to confirm), **ask** ("how many bookings today?", "what did people ask about this week?" from collections and history), **pause and resume** the bot, and approvals in the same chat | ally-be, ally-ai | Text "closed Monday", confirm, and customers are told; ask "bookings today?" and get the count; "pause" stops replies until "resume" |

## Phase E — Templates

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 18 | **Template format, install and export.** `template.yaml` with pages, collection schemas and sample rows, people fields and relations, memory settings, ability settings, rules, setup questions and eval cases. Install into a bot; export any bot as a template (without records, people or memories); versioning; the safety layer can't be removed | all three | Export the clinic bot, install it as a new bot with a different name and hours, and its evals pass |
| 19 | **Template builder, sharing and the official set.** Build or edit a template in the dashboard or as files; share within the organisation or by private link; import. Ship ten official templates (mental health FAQ, clinic, travel, shop, SaaS support, coaching, real estate, gym, public-services helpdesk, HR), each with passing evals | all three | Someone outside the team imports a shared template link and has a working bot |
| 20 | **Onboarding: templates and sandbox** (extends 20a). Pick a template or "start blank"; paste a website or upload documents to draft pages and sample rows; answer the setup questions; try it on the sandbox number with a join code; connect WhatsApp, all in under 10 minutes | all three | A new user goes from nothing to a live test chat in under 10 minutes, timed |
| 20a | **Agent-first onboarding, quick-start** (slice 1; see `SLICE-1.md`). A builder agent (`/builder/step`, streaming) talks with the owner while a live canvas fills in; it reads the website visibly, shows what it learned with links to each page, detects the industry and applies a **safety pack**, asks only about gaps, proposes 2–3 designs ("coming soon" for booking and orders), builds the bot, runs a **readiness check** of 10–15 questions with sources, then publishes a **branded bot page link**, QR code and share text. Afterwards, "change it by chat" with before-and-after, Confirm and Undo. All changes are JSON patches to a `BotDraft`, validated and applied by ally-be through one `BotDraftService` that chunks 18–20 extend later | all three | For each fixture site (mental health, clinic, lab, pharmacy, wellness, D2C, coaching, real estate, SaaS, restaurant): website to shared link in under 5 minutes, a readiness check with 0 unsourced answers, the right safety pack, and the bot answers by link |

## Phase F — Ready for customers

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 21 | **Privacy, quality and rollout.** Consent and opt-in records; data export and delete on request (India's DPDP Act), covering memory, history, records and files; retention jobs; per-template evals in CI; load test; per-bot cost cap; Home (needs-you list, weekly numbers, top topics); a migration tool to move v1 bots to v2 | all three | Export and delete a contact's data end to end; CI blocks a template whose evals fail; Home matches the data |

## Still in v3

Campaigns and routines (broadcasts, announcements, daily digest, campaign templates), the visual flow builder, fully automatic learning, connectors, MCP and any API as a tool, the public template gallery and skills store, forms and WhatsApp Flows, Slack and Teams, custom domains and multi-page sites.

Light follow-ups (6F) and owner-approved learning (8L) moved into v2; fully automatic learning and the visual flow builder stay in v3.

## Release gates

| Gate | After | What must be true |
|---|---|---|
| **G1: first real bot on v2** | before Stage 1 goes live (was after 3b) | Ops: checkpoint DB, retention, reasoning effort, agent prompt published. Ally FAQ in Shadow for a week (≥ 95% match on intent and decline, no crisis differences), then v2 with Agent mode |
| **G2a: the agent core** | 8L | A pilot bot remembers a returning person across two channels; Forget works end to end; no clinical details in memory or logs; learning proposals approved or rejected by a real owner |
| **G2: blocks and memory live** | 9 | A pilot clinic runs bookings on Collections (built from blocks, not code) and the bot remembers returning patients; Forget and masking work end to end; no PHI in logs |
| **G1b: bot pages live** | slice 1 (15a) | The crisis classifier reviewed end to end (deferred from 3c) before any **public** bot page goes live; rate limits and the daily cap on; one internal and one pilot bot shared by link |
| **G3: team-ready** | 13 | A pilot business with staff uses the team inbox and rich messages; the widget is on one website |
| **G4: trusted, visible, owner-run** | 17 | Approvals, the Never check, history and Why? in use; the owner runs the bot from WhatsApp; learning mode for each new bot's first week |
| **G5: anyone can build** | 20 | Ten official templates pass their evals; a non-Ally user builds and shares their own template; onboarding under 10 minutes |
| **G6: v2 complete** | 21 | Privacy controls, CI evals, cost cap, v1 bots migrated |

## Order and timing

The order is the Stages table above: Stage 1 (20a-1 → 20d → 20a-2 → 15a → 20e) to v2.0 in late November 2026, then Stages 2–8 to v2.7 in early April 2027.
