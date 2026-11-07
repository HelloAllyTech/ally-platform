# Agents v2 — build chunks

Read `CONTEXT.md` first. Product spec: `agents-v2-spec.md`. Engineering detail: `three-stage-plan.md`. What exists today: `stage1-build.md`. All are in this folder.

## How to use this file

- Each chunk is sized for **one Claude Code loop**: a single branch, roughly 1–3 days of work, one PR.
- Each chunk **ships dark**. It sits behind the per-bot `runtime: v2` setting or a feature flag, so Stage 1 bots never change until you switch them over.
- Each chunk ends with **"You test"**: the exact checks you run before moving on. Don't start chunk N+1 until chunk N passes.
- Give Claude Code one chunk brief at a time (`chunk-01.md`, then `chunk-02.md`, and so on). Ask for the next brief once a chunk passes.
- Repos: **ally-ai** (Python, LangGraph), **ally-be** (TypeScript, migrations, WhatsApp, engine), **ally-web** (admin dashboard, RTK Query).

## Rules that hold for every chunk

1. Don't change v1 behaviour. Every new path is opt-in per bot.
2. Graph decides, ally-be executes. ally-ai never writes to the database or sends messages. It calls the ally-be tool gateway.
3. Every send and every tool call has an idempotency key. A retry must never message a person twice.
4. Safety only tightens. The crisis check, consent and STOP behave exactly as in Stage 1, or stricter.
5. Each chunk adds its own tests, and leaves CI and flake8/lint green.
6. Each chunk ends with a short `CHUNK-NN-NOTES.md` in the PR: what changed, how to test, and anything left open.

---

## Phase A — New engine (epic 1)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 1 | **LangGraph runtime with parity.** The current knowledge pipeline rebuilt as a LangGraph graph behind `POST /agent/run`, with a Postgres checkpointer and a parity script | ally-ai | `curl /agent/run` answers like `/knowledge-agent/answer`; the parity script shows matching decisions and citations on 20+ cases |
| 2 | **Runtime switch in ally-be.** Per-bot `runtime: v1 \| v2` plus feature flags; the engine's answer step calls `/agent/run` for v2 bots; Preview shows the runtime and run id; the run id is stored on the outbound message | ally-be, ally-web | Flip one bot to v2 in the dashboard, chat on WhatsApp, and get the same answers; flip back with no residue |
| 3a | **Conversational agent.** The `write` step becomes an `agent` node that talks like an assistant: it uses the conversation history to understand follow-ups, answers greetings, thanks and "who are you / what can you do" in the bot's own voice, and calls tools in a loop (capped at 4 in the plan; 2 as built, `AGENT_RUNTIME__MAX_TOOL_CALLS`, see CHUNK-03A-NOTES §12). A tool registry in ally-ai, each tool one small module; first tool `search_knowledge` (RAG as a tool, so it can search again with a better query). The decline gate stops being a dead end for small talk, but **any factual claim still needs a citation**, so out-of-scope questions still decline. v2 bots can turn off the rigid greeting/help quick replies; safety, consent and STOP keywords stay in ally-be | ally-ai, ally-be, ally-web | "Hi", "thanks", "who are you?" and "what can you do?" get natural replies in the bot's voice; "and how do I sign in after that?" is understood from the earlier turn; out-of-scope facts still decline; the conversation eval passes |
| 3b | **Tool gateway.** ally-be internal routes `GET /internal/agent/context` and `POST /internal/agent/tools/:name` with a per-run token, idempotency, a `tool_runs` table and a per-bot tool allow-list. First gateway tool: `get_bot_profile` (name, what it covers, document titles), so later tools (facts, memory, schedules) just add files | ally-be, ally-ai | Every tool call shows up in `tool_runs`; a replayed call returns the stored result; a tool not on the allow-list is refused |
| 3c | **Streaming and typing.** ally-ai `POST /api/v1/agent/run/stream` (SSE): `step` events per node, `token` events for the answer text, one `final` event identical to `/agent/run`'s response. ally-be relays the stream to channels that can show it (a `streaming` capability on the connector registry); Preview streams now, the website widget reuses it in chunk 21. **Nothing reaches a person before the crisis check clears** (tokens are held until it does), and `final` always wins (a late decline or crisis replaces the streamed text). WhatsApp can't stream, so it gets a typing indicator as soon as a message arrives instead. Also a hard timeout on the whole run (`asyncio.timeout` around the graph, mapped to 504), so a slow step can't run on after ally-be has given up (REVIEW-1-3A #62) | ally-ai, ally-be, ally-web | Preview shows "Searching… Writing…" and the answer appearing word by word; the final text and citations match `/agent/run`; a crisis question never shows streamed text; on WhatsApp the typing indicator appears within a second |

## Phase B — Memory you can read (epics 2 and 3)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 4 | **Layered context files.** `context_files` and versions tables; the `load_context` node merges platform > org > agent > role; About and Agent pages in the dashboard with edit, version history and restore | all three | Edit the Agent page and the next reply follows it; restoring an old version brings the old behaviour back |
| 5 | **Facts.** `data_tables` and `data_rows`, a `look_up_facts` tool, and a Facts screen with a table editor and CSV import | all three | Add a price list; "how much is a haircut?" answers from the row and the reply cites it |
| 6 | **Contact profiles and notebook.** A channel-agnostic `agent_contacts` identity (linked to `wa_contacts`, ready for the web widget later); `contact_memory`; `remember` and `recall` tools; USER.md view; profile panel in Conversations with sources, edit and forget; the agent notebook | all three | Tell the bot your name and preference; it remembers next time; Forget removes it, and the next run shows it's gone |
| 7 | **Configurable fields and file types.** Per-bot field schema; file storage; `save_file` and `read_file`; reading invoices and business cards into fields; the Direction setting | all three | Send a business-card photo and the fields fill in, each with a source; a field marked "never store" is never saved |
| 8 | **Documents the business sends.** Attach a file to a profile and send it from the dashboard or by forwarding on WhatsApp; delivery tracking; a template outside the 24-hour window | all three | Send a sample invoice to a test contact; it arrives and the status turns delivered |

## Phase C — History and "Why?" (epic 4)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 9 | **History search and summaries.** Search across conversations, a summary per conversation, and unanswered chats grouped into topics | all three | Search "insurance" and find the right threads; the topics list groups similar unanswered questions |
| 10 | **"Why?" card.** Run trace from the checkpointer, turned into a plain-language card on every reply (sources used, facts, memory, rules, abilities) | ally-ai, ally-web | Click Why? on any v2 reply; the card matches what actually happened in the run |

## Phase D — Abilities and trust (epics 7 and 9)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 11 | **Abilities with Do it, Ask me first and Never.** Ability registry for the eight built-in abilities; per-bot setting; LangGraph `interrupt` for Ask me first; approvals inbox on the web | all three | Set "hand over" to Ask me first; the run pauses, you approve on the web, and it resumes in the same conversation |
| 12 | **Owner on WhatsApp: approvals, handover and notify team.** Register an owner number; approve or deny with WhatsApp buttons; handover promises with tracked reply times | ally-be, ally-ai | Approve a pending action from your phone; a handover shows a promised time and an alert fires when it's missed |
| 13 | **Never check and learning mode.** Pre-send check against the Never list; learning mode sends unsure answers to the owner as drafts | ally-ai, ally-be | A reply that breaks a Never rule is blocked and logged; in learning mode, an unsure answer reaches you as a draft first |

## Phase E — Scheduler and flows (epic 8)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 14 | **Scheduler core.** `scheduled_jobs` and a worker with keys; quiet hours; opt-out checked at send time; the 24-hour rule with template choice; a `schedule` tool for follow-ups and reminders; smart wake-ups | ally-be, ally-ai | "Remind me tomorrow at 10" arrives once at 10 (after quiet hours); STOP before then cancels it; restarting the worker doesn't double-send |
| 15 | **Schedules screen, owner scheduling, announcements and templates.** Calendar and list view; the owner creates schedules in plain words with a preview and Confirm; announcements to opted-in people; template submission to Meta | all three | From your phone, "remind everyone who asked about X on Friday" shows a preview with the count, then sends on Friday |
| 16 | **Flows engine.** Flow definitions and runs; triggers from profile dates, conversation events, tags and files; steps, caps, priority and exits; five ready-made flows | ally-be, ally-ai | Switch on Collect reviews; a completed visit triggers the rating request; a 5 gets the link and a 2 goes to Needs you |
| 17 | **Flow builder, plain-words flows and flow pages.** Step-list builder; describe a flow on WhatsApp and get a preview; dry run; a results page per flow | all three | Build a reminder flow in plain words; the dry run lists who would get what this week; the flow page shows live numbers |

## Phase F — Onboarding (epics 5 and 6)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 18 | **Sandbox number with join codes.** An Ally-owned number; a join code routes a phone to a draft bot | ally-be | Text the join code from any phone and chat with your draft bot before connecting a number |
| 19 | **Onboarding and self-drafting.** Website, documents or a description in; drafted pages, facts, abilities and a starter flow out; review, try and go live in under 10 minutes | all three | A new user goes from nothing to a live test chat in under 10 minutes, timed |

## Phase G — Website widget (epic 13)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 20 | **Shared conversation store.** Channel-agnostic conversations and messages tables, with WhatsApp data backfilled and writes going to both during the switch | ally-be | Existing WhatsApp history shows unchanged; new messages land in the shared tables |
| 21 | **Website chat widget.** Embed script, `web` connector, branding, page rules, Continue on WhatsApp with memory carried over | all three | Paste the snippet on a test page and chat; continue on WhatsApp and the agent knows the earlier chat |

## Phase H — Learning, owner mode and home (epics 10, 11 and 12)

| # | Chunk | Repos | What you can test at the end |
|---|---|---|---|
| 22 | **Self-learning loop.** Nightly reflection; lessons inbox; impact preview; apply and undo; owner locks | all three | After a day of test chats, lessons appear the next morning; apply one and the behaviour changes; undo reverts it |
| 23 | **Owner manager mode and daily digest.** Teach, ask, pause and resume from WhatsApp; daily digest | ally-be, ally-ai | Text "we're closed Monday" and the About page updates (after you confirm); the digest arrives each evening |
| 24 | **Home, insights and cost cap.** Needs-you list, five weekly numbers, what it learned; per-bot monthly cost cap | ally-web, ally-be | Home matches the data; hitting the cap switches to the fallback behaviour and alerts you |
| 25 | **Hardening and rollout.** Eval set in CI, load test, alerts, a migration tool to move v1 bots to v2, and docs | all three | Eval and load reports pass the quality bars; one real bot runs on v2 for a week with no regressions |

## Order and parallel work

- **Do these strictly in order:** 1 → 2 → 3a → 3b → 3c. Everything else needs the gateway. Every node and tool writes a `trace` step, so 3c (streaming) can show them live.
- **After 3, they can run in parallel:** 4–5 (context), 6–8 (profiles), 9–10 (history), 18 (sandbox), 20 (shared store).
- **Next:** 11–13 (abilities), then 14–17 (scheduler and flows), then 19 (onboarding needs pages, facts, abilities and flows), then 21, 22, 23, 24 and 25.
- With one person driving Claude Code, plan on about one chunk every 2–4 days including your testing, so roughly 15–17 weeks. That matches the spec's estimate.
