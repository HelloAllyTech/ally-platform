# The complete plan: today, the merge, the sprints, v3 and what was skipped

> The one map, checked against the original plans: `three-stage-plan.md` (the product), `v2-chunks.md` (v2's chunks and stages), `FAST-TRACK.md` (P0–P3). Where they disagree, this file wins for order; `v2-chunks.md` still describes each chunk. Updated 14 Nov 2026, 18:45, while 5b builds. <!-- docs-path-lint: planned -->

## Contents

1. Where we are
2. Today and tonight: 5b, 8a, then the merge
3. The merge to master and the release
4. Everything that's left (v2 and v3)
5. The order: sprints 1–5
6. Sprint details
7. Skipped and cut: everything we set aside, and where it went
8. Things that take days outside the code

## Where we are

**Done, about 22 chunks:**
- **Engine:** 1, 2, 3a, 3r, 3c, 3d. The LangGraph agent, streaming, every bot on v2.
- **Slice 1 and Stage 1, the POC:** 12, 12b, 13, 20a-1, 20d, 20a-2, Q2a, 11a, 20d-2, CL1. Website → tested assistant → bot page, bubble, WhatsApp, checkups, scorecard and a light inbox.
- **The fast track:** H0, 15a (public links are safe), 3b (the tool gateway), 5a (lists), 6 (it books from lists).
- **Building now:** 5b (Lists in the dashboard).

**Not released yet:** all of the fast track sits on one local branch. Production still runs v1 until `0fb34139c` is released.

**In the original plan's terms:**

| Original stage | Where it stands |
|---|---|
| 1 The POC | ✅ Done, not yet released |
| 2 Agent core (3b, 4, 7, 8, 16a, 8L) | 3b ✅; 8a next. 4, 7, 16a and 8L not started |
| 3 Quality (Q1, Q2) | The core is built (20a-2, Q2a); nightly runs and alerts are left |
| 4 Building blocks (5, 6, 6F, 9) | 5 and 6 ✅ in light form; 6F and 9 not started |
| 5 Templates (18, 19, 20) | Not started; the catalogues are written (`READY-MADE-LISTS.md`, `BUSINESS-TEMPLATES.md`) |
| 6 Conversations and public links (10, 11, 15a, 20e) | 15a ✅; 20e's brief is ready; 10 and 11 not started |
| 7 Trust and the owner (14, 15, 16b, 17) | Not started |
| 8 Ready for customers (21) | Not started |
| v3 | Not started |

**Roughly:** the foundations are done (the agent, safety, channels, the gateway, lists and booking). By count, about 40% of v2's chunks. By difficulty, more than half: what's left mostly builds on what exists.


## Today and tonight: 5b, then 8a, then the merge

One session, in this order. Times are estimates.

| When | What | You |
|---|---|---|
| **Now → ~22:00** | **5b** finishes: the design stop (screenshots and §27 copy), then the screens, Playwright and notes | Approve the design and copy at the stop; review the report |
| **~22:00 → overnight** | **8a, Memory light** (`chunk-8a.md`): memory lines, the rolling summary, the Inbox panel | Approve the three prompts at its stop (from your phone); review the report in the morning |
| **Sunday morning** | **The merge** (next section) | Run the checkups; review the PR; release |

**If 5b runs late,** start 8a anyway once 5b's ally-be part is committed, and let the session finish 5b's last screens after 8a. 8a doesn't touch 5b's screens.

**Start 8a with:** `Read docs/agents-v2/CONTEXT.md, then docs/agents-v2/chunk-8a.md, and build chunk 8a.` The brief is in this project (`chunk-8a.md`); put it in the repo's `docs/agents-v2/` first, as with 5a and 6.

## The merge to master and the release

### Before the merge

1. **8a reports done,** and its memory cases pass.
2. **Run the checkups with your admin token** (`CHUNK-06-NOTES.md`, step 8): Sunrise and the fixtures, 0 hard fails and 0 wrong declines. The onboarding eval stays at 9/13 (known; the safety-pack fix opens sprint 1).
3. **Small fixes:** ally-web's lint error (the helpline dashboard file); Host's and Ally FAQ's decline text ("reference material").
4. **Ask the session to bring master into the branch,** resolve conflicts (migration timestamps especially), and run every suite, lint and typecheck in all three apps, plus the lists and memory Postgres specs.
5. **Push the branch and open one PR to master,** with a summary per chunk (H0, 15a, 3b, 5a, 6, 5b, 8a) and links to each notes file. CI green.

### The release (in `LAUNCH-CHECKLIST.md`'s order)

1. **Release `0fb34139c`** first if it isn't on master yet, and watch the v1 fallback rate and reply times for a few hours.
2. **Deploy ally-ai, then ally-be** (its migrations: `tool_runs`, the lists tables, `memory_entries`), **then ally-web.**
3. **Environment:** `AGENT_GATEWAY_SECRET`; `PUBLIC_API_BASE_URL` reachable from ally-ai; Turnstile keys and the `/b/*` rules.
4. **Confirm production's key can call gpt-6-luna,** then push the prompts: the checkup judge, then the crisis prompt, then `ally_ai_agent_lists`, then the three memory prompts.
5. **Everything new starts off:** list tools at Never, memory off, `hand_over` off, public links on for two assistants only.
6. **Watch for a few hours:** fallbacks, reply times, errors. **Rollback** is the platform switch back to v1.
7. **Then, one pilot at a time:** helpline numbers set → public link → `hand_over` on (with `sharedStoreWrites` on for WhatsApp) → list lookups → bookings (Do it) only after its action cases pass → memory only after its memory cases pass. Check new bookings daily in the first week.

When this is done, the fast track is complete: public links, booking from the owner's own lists with a dashboard, and an assistant that remembers people.

## Everything that's left

### v2

| Area | What's left | Chunk |
|---|---|---|
| **Memory and people** | Memory light (profiles, preferences, Forget, a rolling summary of long chats) | 8a |
| | Memory, the rest: custom profile fields, the nightly tidy, the agent's notebook, memory carried across channels | 8 |
| | People and relations: parent ↔ child, lead ↔ assigned agent, team members, segments | 7 |
| | Roles, light: staff by number, a role's own instructions and abilities | 7a (new) |
| **History and learning** | Search past chats, summaries, "what did we discuss last month?" | 16a |
| | Why? on every reply | 16b |
| | Learns from conversations, with the owner approving each change | 8L |
| **Building blocks** | Follow-ups: reminders before a date, messages after a change | 6F |
| | Media and voice: voice notes in Hindi, Marathi and Hinglish; photos and documents into fields | 9 (9a first) |
| | Lists, the rest: recurrence, board and calendar views, waitlists, `check_rules` | 5, 6 |
| | Workspace: instructions as pages in a file tree, per role | 4 |
| **Conversations** | Rich messages: buttons for slots, list menus, photos, documents, template messages outside 24 hours | 10 (10a first) |
| | Full team inbox: assignment, notes, reply-time promises | 11 |
| | The landing page | 20e |
| **Trust and the owner** | Ask me first, with approvals on the web and on WhatsApp | 14a, 14 |
| | The Never check and learning mode | 15 |
| | The owner runs it on WhatsApp: teach, ask, pause | 17 |
| **Templates** | Install and export a whole assistant | 18a, 18 |
| | Template builder, sharing, the official set | 19 |
| | Onboarding from a template in under 10 minutes | 20 |
| **Ready for customers** | Erasure and export, caps (21a); CI evals, load test, v1 migration (21) | 21a, 21 |
| | Remove v1, 4 weeks after the release with 0 fallbacks | CL2 |
| | Safety-pack declines fix (the onboarding eval's open fail) | small |

### v3 (from `v2-chunks.md` "Still in v3" and `three-stage-plan.md`)

| Area | What it is |
|---|---|
| **Connect anything** | Any API or OpenAPI URL as a tool; **MCP servers** as tools; a webhook that starts the assistant; events sent out to the owner's systems |
| **Built-in connectors** | Google Calendar or Cal.com, Razorpay payments, HubSpot or Google Sheets |
| **Campaigns** | Broadcasts to opted-in segments, announcements, the owner's daily digest |
| **Forms** | Forms filled by chat, voice or WhatsApp Flows, writing list entries |
| **Flows** | The visual flow builder (fixed recipes come first, in 6F and 10a) |
| **Trust, the big ideas** | The commitment check (prices, discounts and dates checked against what the owner allowed, before sending); the promise ledger ("we'll call you back" becomes a task with an owner and a deadline) |
| **Learning** | Fully automatic learning, for areas the owner trusts |
| **Two doors** | `workspace.yaml` and an SDK editing the same assistant as the dashboard |
| **Quality** | Golden chats and a replay gate before publishing; earned autonomy (draft → automatic on measured staff acceptance) |
| **Growth** | Embedded Signup (one-click WhatsApp), Ally as an MCP server, the public template gallery and skills store, Slack, Teams and Instagram, custom domains, the proof page, the open-source release |

## The order

One session at a time. A sprint is about 4–5 days at this sprint's pace (about 2–3 chunks a day, with your reviews). Every sprint keeps one day for what testers hit.

| Sprint | Name | What ships | Days |
|---|---|---|---|
| **0** | **Finish the fast track** | 5b, then 8a (memory light, the rolling summary of long chats), then release to master and production | 1–2 |
| **1** | **Ready for people** | The safety-pack fix; 21a erasure and caps; error tracking and feedback; 20e landing page; 9a voice notes in; **4a Workspace, light** (the company's context, pages and skills); 7a Roles, light; 18a Templates, light; the 12 showcase assistants | 5–6 |
| **2** | **It acts on its own** | 10a template messages; 6F reminders and messages after a change; 14a Ask me first, with Approve buttons on WhatsApp; 10 buttons and lists for picking slots; 17 owner on WhatsApp, light (pause, "bookings today?") | 5 |
| **3** | **Connect anything** | Your own API tools (and OpenAPI); MCP servers as tools; a webhook that starts the assistant; events out; Google Calendar and Razorpay links, built on the same tool rail | 5 |
| **4** | **Remembers and learns** | 8 memory, the rest, and 7 people and relations; 16a history search; 16b Why?; 8L learns with approval; 15 the Never check; the commitment check | 5 |
| **5** | **Scale** | 11 full team inbox; 19 and 20 template builder, sharing and onboarding from a template; broadcasts and the daily digest; forms and WhatsApp Flows; 21 the rest; CL2 remove v1; Embedded Signup | 5–6 |
| **Later** | | 4 Workspace, the rest (skills, learning proposals into pages); lists' views and recurrence; the visual flow builder; automatic learning; the public gallery; Slack and Teams; custom domains; two doors; the open-source release | — |

**In total:** about 5 more sprints, roughly **5–6 weeks** at the current pace, to finish v2 and the most useful parts of v3. The "Later" row is v3's long tail.

**Why this order:**
- **People first (sprint 1),** because real use decides what matters in sprints 2–5. Templates are the use cases, so they come with it.
- **Acting on its own (sprint 2)** needs memory (sprint 0) and roles (sprint 1), and it's what owners will ask for next ("remind them the day before").
- **Connect anything (sprint 3)** builds on the gateway and approvals. Calendar and payments become thin tools on that rail instead of separate chunks.
- **Memory, the rest, and learning (sprint 4)** are best built from real conversations, which sprints 1–3 produce.
- **Workspace light (4a) comes in sprint 1, before roles and templates:** templates package pages (`/org`, `/agent`, `/roles`), and 7a needs a role's own instructions. Building those on today's instructions field and moving them later would be done twice.

## Sprint details

### Sprint 0: 8a, Memory light (tonight)

The brief is `chunk-8a.md`. In short:
- **Within a conversation:** the last 10 messages in full, and older ones summarised after the reply, never while the person waits.
- **Across conversations:** memory lines about each person (preferences, context, open items), each with its source, kept in ally-be, never in the checkpointer. The agent proposes them with `remember`; ally-be stores them after the reply, never from a crisis run, and never clinical details on health assistants.
- **The owner sees them in the Inbox** and can forget or edit any line, or Forget this person. Off by default per assistant.

### Sprint 1: Ready for people

#### Before more than a handful of people use it

- **The safety pack's declines fix** (the open onboarding eval, 9/13).
- **21a, erasing a person's data:** needed before real customers' details pile up (India's DPDP Act).
- **Limits and costs:** messages per assistant per day, a monthly cap per owner, and an alert before it's reached.
- **Seeing problems:** error tracking on all three apps, and a daily summary of failed runs, refusals and hand-overs.
- **Feedback:** thumbs on replies in Try it and in the conversations view, plus one "Tell us what's missing" box for owners.
- **Turnstile, rate limits, PUBLIC_API_BASE_URL** (already in LAUNCH-CHECKLIST).

#### 4a Workspace, light (about 8 h): the company's context and the filesystem agent

- **`workspace_files` with versions,** as in `TEMPLATE-DATA-MODEL.md` §2: `/org/ORG.md` (shared by every assistant of the organisation: its real name, what it does, locations, hours, policies, tone), `/agent/AGENT.md` (today's instructions, migrated), `/roles/<role>.md`, `/knowledge/*` (owner notes migrated), `/updates/*` with an expiry ("closed Monday").
- **Always loaded within a budget:** `/org`, `/agent` and the sender's `/roles` page. Read on demand: `/knowledge` and `/updates`.
- **Tools:** `list`, `read`, `grep`, beside `search_knowledge`. The agent writes nowhere in the workspace yet (memory stays in 8a's rows).
- **Replaces the `organisation_of` guess** with the explicit name in ORG.md.
- **The dashboard:** the home's instructions become page editors with history and restore; an Updates block with expiry dates.
- **`/skills/*`, read-only:** how-tos a template ships ("take a table order", "reschedule a booking"). Only their names and one-line descriptions are in every run; the agent `read`s one when it's relevant.
- **Templates install into the workspace (with 18a):** a template's pages are written here, so the assistant acts as that template from its files, and the owner edits them like any page. See `BUSINESS-TEMPLATES.md`, "Pages a template writes".
- **Waits (chunk 4, the rest):** learning proposals into pages, the agent writing to `/scratch`.

#### 7a Roles, light (about 6 h)

- Staff by WhatsApp number or email, each with a role.
- Each role has its own instructions and abilities. The safety layer is the same for everyone.
- This unlocks the ★ parts of the templates: waiters, receptionists, agents, HR.

#### 18a Templates, light

- One-click install of a whole template: roles, instructions, lists, abilities, checkups and the safety pack, plus its setup questions.
- "Save as template" from any assistant: its pages, lists (no entries), roles, abilities, checkups and safety pack, never contacts, memory or conversations. The owner names it, the builder suggests setup questions, and it's shared inside the organisation or by private link.
- **Build it by chat:** change by chat (20a-2) learns to propose a new list, a role, a page or a skill as one before-and-after patch ("after each visit, ask for a review"). Apply, then Save as template.
- The 14 in `BUSINESS-TEMPLATES.md` ship as the default catalogue.

#### The showcase: 12 assistants that show everything

Each is installed from its template as a public demo with its own link: visitors chat with it, owners install it in one click. As later sprints land, the same 12 gain reminders, approvals, API tools and memory, so the demos keep improving without new ones.

| # | Showcase | What it shows off |
|---|---|---|
| 1 | **Restaurant** (Sunrise Café) | Menu lookups, veg and allergen honesty, table booking with rules, ★ waiters placing orders on WhatsApp |
| 2 | **Clinic** | Booking from slots, the medical safety pack, "where's my report?" handed to a person |
| 3 | **Therapy practice** | The crisis reply first, hand-over, booking a first session gently |
| 4 | **Real estate** | "2BHK in Baner under 85 lakh" with ranges, site visits, ★ agents' day view |
| 5 | **Gym or yoga studio** | Class capacity, "when does my membership end?", per-person privacy |
| 6 | **Coaching institute** | Admissions enquiries from parents, the young-people pack |
| 7 | **Online store (D2C)** | Products and stock, "where's my order?", returns as tickets |
| 8 | **Diagnostic lab** | Prices and preparation from documents, home collection by pincode |
| 9 | **Hotel or homestay** | Room rates, stay requests, local information from documents |
| 10 | **Car service centre** | "Is my car ready?", ★ mechanics moving a job along |
| 11 | **Housing society** (new) | Complaints as tickets, clubhouse booking, notices from documents, ★ the committee |
| 12 | **Internal HR helpdesk** | Staff only: policies from documents, leave requests, ★ the HR manager approves |

#### Giving it to people

- **The first 10–20 businesses, invited, not public:** one per showcase type, plus a few you know well.
- **What to watch:** do they finish setup? Does the assistant get a real conversation in its first week? What do they hand over or turn off?
- **Go wider** once the first group's assistants run for a week without you stepping in.

### Sprint 2: It acts on its own

- **10a template messages:** WhatsApp only allows Meta-approved templates more than 24 hours after the person's last message. Every reminder, follow-up and webhook-started message depends on this. **Submit the starter templates now** (appointment reminder, booking confirmed, review request); approval takes days.
- **6F follow-ups:** "the day before", "2 hours before", "5 days before the membership ends"; "when an order moves to sent, tell the customer". Fixed recipes set per list in plain words, with quiet hours, once per person and opt-out.
- **14a Ask me first:** the assistant prepares a booking or change and the owner approves it from an inbox or with a WhatsApp button.
- **10, slots as buttons:** "Morning or evening?" and a list of free times to tap.
- **17 light:** the owner's number can pause and resume the assistant and ask "bookings today?".

### Sprint 3: Connect anything

All four run through 3b's gateway: ally-be makes every outside call, never ally-ai ("the graph decides, ally-be executes"), and each tool gets Do it, Ask me first or Never and is logged in `tool_runs`.

#### Your own API tools

- The owner describes an API call once: URL, method, headers (secrets stored encrypted, never shown to the model), what the assistant fills in, and which parts of the response it may see. Or pastes an OpenAPI URL and picks operations.
- A Test button with a sample call.
- Example: "Register this person for Saturday's webinar" calls the owner's signup API.

#### MCP servers as tools

- The owner adds a remote MCP server by URL (with its sign-in, OAuth or a key). ally-be lists its tools, and the owner turns on the ones the assistant may use.
- Only chosen tools are described to the model, so a big server doesn't bloat every run (the Hermes lesson in `three-stage-plan.md`).
- Each tool's description is shown to the owner before it's enabled, and re-checked when the server changes it, because a server can change what its tools say.
- This also gives Google Calendar, Sheets, HubSpot and the like through their MCP servers, without us building each one.
- **Later, the other direction:** Ally as an MCP server, so other agents can look up and book in an owner's lists.

#### A webhook that starts the assistant

- The owner's website or system calls a signed URL ("new signup", "payment failed") with a contact and some data, and the assistant messages the person or runs a sprint 2 recipe.
- Signed with a per-assistant secret, idempotent by event id, rate limited. On WhatsApp the first message is an approved template.

#### Events out

- ally-be posts "booking created", "hand-over requested" and "lead added" to the owner's URL, signed and retried. Zapier and Make work with this on day one.

#### Safety for all of them, decided up front

- No private or internal addresses (SSRF); HTTPS only; a timeout and a size limit.
- Responses are data, never instructions: they can't change what the assistant is allowed to do.
- Writes to outside systems start at Ask me first, not Do it.

### Sprint 4: Remembers and learns

- **8, the rest, and 7:** custom profile fields, relations (parent ↔ child, lead ↔ assigned agent), segments, the nightly tidy, memory carried across channels (Continue on WhatsApp), the People page.
- **16a:** search past chats, summaries, `recall` ("what did we discuss last month?").
- **16b:** Why? on every reply: pages, records, memory, rules and abilities used.
- **8L:** learns from conversations: declines, corrections and hand-overs become proposals (an answer, a page edit, a skill) the owner approves; approved items become checkups.
- **15 and the commitment check:** every reply checked against the Never list, and prices, discounts and dates checked against what the owner allowed; learning mode sends unsure replies to the owner as drafts in an assistant's first week.

### Sprint 5: Scale

- **11:** the full team inbox: assignment, notes, reply-time promises and alerts.
- **19 and 20:** the template editor, template upgrades with a before and after, onboarding from a template in under 10 minutes.
- **Broadcasts and the daily digest:** opted-in segments, approved templates, the owner's evening summary.
- **Forms and WhatsApp Flows,** writing list entries.
- **21, the rest:** per-template evals in CI, a load test, the v1 migration tool; Q1 and Q2, the rest (nightly checkups, alerts).
- **CL2:** remove v1, 4 weeks after release with 0 fallbacks.
- **Embedded Signup** (needs Meta Tech Provider status).

## Skipped and cut: everything we set aside, and where it went

Nothing here is lost: each item names the sprint that picks it up, or says it's v3.

### Cut from chunks we built

| From | What was cut | Where it went |
|---|---|---|
| 3b | The `abilities` table, approvers, Ask me first | 14a (sprint 2) |
| 5a, 5b | Stored recurrence (Repeat weekly only adds entries) | Lists, the rest (later) |
| 5a, 5b | Board and calendar views, saved filters, bulk edit, undo for definition changes | Later |
| 5a | Waitlists; a range rule (overlapping hotel stays); rollups, formulas, multi-select and file fields; `options_from` (selects filled from the knowledge) | Later; files with 9 |
| 5b | Field permissions per staff role | 7a (sprint 1) |
| 5b | A dark home (every section) | Later |
| 6 | `check_rules` (eligibility and pricing rules) | Later |
| 6 | Slots as WhatsApp buttons | 10 (sprint 2) |
| 6 | The time check misses a time confirmed more than two messages back (it asks again); "at 4" accepts 04:00 or 16:00 | Fix with 10's buttons, or when a pilot hits it |
| 6 | Why? citing a record | 16b (sprint 4) |
| 8a | `recall` (search past chats) | 16a (sprint 4) |
| 8a | Custom profile fields, the nightly tidy, the notebook, memory across channels, the People page, relations | 8 and 7 (sprint 4) |
| 12, 12b | Making the shared store the source of truth and stopping the dual-write; Meta profile names; consent fields for web contacts | Sprint 1's spare day, or 21a |
| 3c | A WhatsApp typing indicator (if not shipped) | 10 (sprint 2) |

### Moved out of the fast track

| Item | Now |
|---|---|
| 14a Ask me first, light | Sprint 2 |
| 21a Privacy and caps, light | Sprint 1 |
| 10a + 6F Proactive messages | Sprint 2 |
| 20e Landing page | Sprint 1 |
| 9a Voice notes in | Sprint 1 |

### Open fixes, small

- **The safety-pack declines** (onboarding eval 9/13): first thing in sprint 1, and before 20e opens sign-ups to health or under-18 businesses.
- **With `hand_over` off,** the assistant can promise "I'll pass it on" with nothing behind it: trim that line when `hand_over` isn't offered, or turn it on for pilots.
- **The Overview's "Handed to a person"** counts team replies, not hand-overs, so it shows 0.
- **`hand_over` summaries** run long and sometimes name the wrong channel. Fix before the inbox shows them.
- **One 3a hard fail, older than 15a:** a joke about a therapist was answered.
- **The organisation's name** is guessed (`organisation_of`): fixed by 4a's ORG.md (sprint 1).
- **Hindi strings marked "needs review"** need a native speaker.
- **ally-web's lint error, Host's and Ally FAQ's decline text:** before the merge.

### Original v2 chunks not built yet

All of them are in the sprints: 4 (4a in sprint 1, the rest later), 7 and 8 (sprint 4), 8L (sprint 4), 9 (9a sprint 1, the rest later), 10 (sprint 2), 11 (sprint 5), 14 (sprint 2), 15 (sprint 4), 16a and 16b (sprint 4), 17 (sprint 2, light), 18 (18a sprint 1), 19 and 20 (sprint 5), 21 (21a sprint 1, the rest sprint 5), Q1 and Q2, the rest (nightly checkups, alerts, WhatsApp thumbs: sprint 5), CL2 (4 weeks after release with 0 fallbacks).

### From the original product plan (`three-stage-plan.md`) not yet scheduled in v2

- **Golden chats and a replay gate:** publishing blocked while a saved real conversation fails (v3; Q1's checkups are the start).
- **Earned autonomy:** each decision moves from draft to automatic only on measured staff acceptance (v3).
- **Tracing per run** in LangSmith or Langfuse, linked from Try it (check what Q2a and How it works cover; otherwise sprint 5).
- **The owner's 9 pm digest** (v3, with broadcasts).

## Things that take days outside the code

From `FAST-TRACK.md` §8, still open:
- WhatsApp utility templates submitted on each pilot's account.
- Meta Tech Provider status (for Embedded Signup).
- Turnstile keys and the `/b/*` rules in production.
- Production's OpenAI key can call gpt-6-luna.
- Two pilot businesses, a clinic and a lead-led business.
- A native Hindi speaker for the strings marked "needs review".
