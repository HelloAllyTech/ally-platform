# Ally Agents: the final plan (19 Nov 2026)

> Everything discussed and everything in the project's docs, in one ordered list, most needed first. Replaces `MASTER-PLAN.md`, `7-DAY-PLAN.md`, `NEXT-STEPS-18NOV.md` and the order in `ROADMAP-NEXT.md` (their chunk descriptions still hold). One Claude Code session at a time, one branch and PR per block. The only stops are approving prompt texts. Production is tested at the end of each phase with Claude in Chrome, against the last round. <!-- docs-path-lint: planned -->

## Already built (on master or in Q3-fast)

Onboarding from a website (safety pack, checkup, publish gate) · the assistant home (Overview, What it knows, Tools, Safety, How it works, Try it, Checkup, Inbox, Share) · bot page, website bubble, WhatsApp · one run path, no v1 fallback · answers with sources, purposes, playbooks per list · lists, ready-made lists, Repeat weekly, booking with rules, leads, orders · memory with Forget and summaries · hand-over and the Inbox · safety packs, the three-level crisis check (crisis reply in about 2 s), owner pack correction · owners-only access, Chatbots-only custom logins, login without sign-up · live steps on the bot page · 6b booking polish.

## Phase 1 — Pilot-ready (decided 19 Nov: accounts, templates and the chat first)

| # | Block | What's in it | Brief | Days |
|---|---|---|---|---|
| 1 | **Ship Q3-fast** | Merge; publish its prompts to production's Skills Store (and check 6b's are live); deploy; remove `agentRuntimeAllowed` | — | 0.5 |
| 2 | **Costs, models, tokens, plans and seats** | **Ally admin → Models:** every model with its price per million tokens; add newer models, update prices (with history), retire or delete. Every AI call and WhatsApp conversation recorded with its cost; Ally admin → Costs with a daily budget and spike alerts. Custom logins become a limited role with a **token allowance** Ally assigns, updates, revokes or deletes. **Plans** (Free publishes up to 3 assistants, Pro more) and **seats** (5 included per assistant for invited people; extra Basic or Premium seats, each renewing on its own date), a monthly customer conversation allowance; Ally assigns them. Every limit pauses politely, crisis replies always go out, no dollars on customer screens. Hide the old WhatsApp number system | `chunk-cr1.md` | 3.5 |
| 3 | **Use-case templates** | 11 templates for what works today, one click in setup or Tools | `chunk-t1.md` | 1.5 |
| 4 | **A chat that feels alive** | The bot page and bubble redesigned: welcome, chips, buttons, cards, images, videos and documents, confirmation cards | `chunk-ui1.md` | 1.5 |
| 5 | **Correct responses** | Round 5 on production, then the answer-quality round: Round 5's findings and the Q3-fast deferred list (search, two-question messages, the right number, finance wording, the grader, combined packs, booking for someone else, the owner-screen bugs), measured on the saved suites. **Fine-tuning a model** only if the suites plateau after that: first the evals, retrieval and prompts, which fixed most of rounds 3–4 | Q4 (from Round 5) | 3 |
| 6 | **Lists and templates v2** | A sturdier version of lists and templates: see below | to write | 3–4 |
| 7 | **Round 6, then two pilots** | Production test; WhatsApp checks for booking and memory; onboard a clinic and a lead-led business | — | 1 |

### Block 6, lists and templates v2 (to be designed)

What "far more robust" should cover, from what broke in testing and what's parked:
- **Lists:** validation on every field, required fields that can't be skipped, image and file fields, relations shown by name everywhere, recurring entries (not only Repeat weekly), waitlists, board and calendar views, bulk edit, CSV import and export that round-trips, undo for definition changes, an audit view per entry.
- **Booking:** availability computed from rules (free means free everywhere), time zones, buffers between slots, staff calendars, booking for someone else, reschedule rules.
- **Templates:** versioned, with upgrades that keep the owner's changes; "Save as template" and sharing; each template carrying its lists, playbooks, safety pack, checkups and starter content; a test that installs every template and passes its checkup.
- **Engine:** one rules engine shared by find, create and update (no disagreements), and a property-based test suite that tries to break the rules.

## Phase 2 — What pilots ask for (weeks 2–3, about 12 days)

| # | Block | What's in it | Days |
|---|---|---|---|
| 8 | **Outbound and campaigns** (one engine; was 10a, 6F and broadcasts) | WhatsApp template manager (create, submit to Meta, track approval); contacts with tags and segments (from chats, lists, CSV); opt-in and opt-out; **campaigns** to a segment, now or scheduled, with variables; **reminders and follow-ups** per list ("the day before", "how was your visit?", "your order has shipped"); quiet hours; delivered, read and replied analytics; replies go to the assistant | 4 |
| 9 | **Rich messages on WhatsApp and a richer owner side** | Reply buttons, list menus, images, videos, documents and carousels on WhatsApp, with text fallbacks; slot picking by buttons; owners attach photos and files to list entries and answers; restaurant pre-chat offers "Table reservation" | 2 |
| 10 | **Owner-defined steps** | Ordered questions with branches and a saved place per person, answers into a list: **surveys, eligibility checks, troubleshooting, lead qualification** (with a lead score), each with a template. Clinical screening forms wait for a clinical review | 3 |
| 11 | **Reports, export and staying current** | Reports per list (counts, averages, top unanswered questions); lead export to Google Sheets; **re-reading pages on a schedule** ("Re-read now", "last read"); export of a person's data (DPDP); the repeated-API-calls fix | 1.5 |
| 12 | **Ask me first and the owner on WhatsApp** (14a, 17 light) | The assistant prepares a booking or change, the owner approves from the Inbox or a WhatsApp button; the owner's number can pause the assistant and ask "bookings today?" | 1.5 |
| 13 | **Languages and voice** | Fixed safety and run-failed replies in Marathi, Tamil, Telugu, Kannada, Bengali, Gujarati and Malayalam (reviewed by native speakers); those languages in the picker; no mixed scripts in replies; WhatsApp voice notes transcribed before answering | 1.5 |
| 14 | **Round 7** | Production test of everything in Phase 2 | 0.5 |

## Phase 3 — Open to everyone (weeks 4–5, about 10 days)

| # | Block | What's in it |
|---|---|---|
| 15 | **Clean the core** (`chunk-r2.md` + CL2) | LangGraph reviewed against its docs, the checkpointer decision, readable code, `ARCHITECTURE.md`, delete the v1 code |
| 16 | **Sign-up and money** | Plan and seat limits re-set from the pilots' costs; landing page (20e); **self-serve sign-up** on the Free plan (date agreed with Sandeep); **Embedded Signup** (a business connects its own WhatsApp number; needs Meta Tech Provider status); **paying online for Pro and extra seats** with Razorpay or Stripe, invoices; retire the WhatsApp number system's readers (report step 2) |
| 17 | **Setup that works on any business** | Reading sites that block bots or are built with scripts; "Describe your business" asking the basics; multi-branch ("only this branch"); maternity, lab and vet packs; setup polish (no "unchanged" name, "Add it now" opens at once, a steady step counter, real branding, names from the business not the domain, topics saved, restaurant defaults, Site visits without listings) |
| 18 | **The team and the workspace** | The full team inbox (assignment, labels, notes, reply-time alerts, a team reply reachable after New chat); staff roles by WhatsApp number (7a: waiters, receptionists); company pages shared by its assistants (4a); the **assistant map** (16c, the n8n-style view and each reply's steps); "Save as template", build by chat, and the 12 showcase assistants |
| 19 | **Payments in chat** | Payment links for fees, deposits and donations; "paid" written back to the list; donors find their receipt |
| 20 | **Round 8, then open sign-up** | |

## Phase 4 — Connect and grow (after launch)

- **Integrations:** Google Calendar and Outlook; HubSpot and Zoho; two-way Sheets; WhatsApp catalog and Shopify.
- **Connect anything:** your own API tools, MCP servers, webhooks in, events out (Zapier and Make work on day one).
- **More channels:** Instagram, Messenger; click-to-WhatsApp ads tracking; Slack and Teams for staff assistants.
- **Trust and learning:** Why? on every reply (16b); history search and recall (16a); memory across channels, profile fields, the People page and relations (8, 7); learning from conversations with owner approval (8L); the Never check and learning mode (15); the commitment check and promise ledger.
- **More use cases:** courses and daily lessons, intake and screening forms (after clinical review), customer uploads with medical-image safety, OTP identity for "show my records", live queue status, voice and phone (LiveKit).

## Parked (decided, not scheduled)

Share by mobile number · dark mode for the home · lists' board and calendar views, recurrence, waitlists, eligibility rules (`check_rules`) · a visual flow builder · two doors (YAML and SDK) · open-source release, public template gallery, proof page · custom domains · Ally as an MCP server.

## Outside the code (start now)

| What | Needed for |
|---|---|
| Submit WhatsApp templates to Meta (reminder, confirmation, follow-up, one promotional) | Phase 2, block 8 |
| Pick the two pilots and a contact at each | Phase 1, block 7 |
| Set the starting numbers for CR1: daily cost budget, starting tokens, assistants per plan, messages per seat type, customer conversations, starting plan for current customers (suggestions in `chunk-cr1.md`) | Phase 1, block 2 |
| A native speaker for regional replies and Hindi strings; a clinical reviewer for crisis wording and screening | Phase 2, blocks 8 and 11 |
| Meta Tech Provider status | Phase 3, block 16 |
| The sign-up date with Sandeep; tell the team support works by the owner adding you | Phase 3, block 16 |
| Run the WhatsApp-numbers production SQL from the report | Phase 3, block 16 |
| Every release: publish approved prompts to production's Skills Store before deploying | Always |
