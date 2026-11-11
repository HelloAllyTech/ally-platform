# Open-Source Agent Workspace: Research & Product Design

> **Superseded in parts; read with `CONTEXT.md` and `v2-chunks.md`, which win.** Shadow mode and the per-bot `runtime: v1 | v2` setting were removed in chunk 3d (one platform switch now, with v1 as the fallback); forms are v3; the build order and stages are in `v2-chunks.md`.

Nov 5, 2026 · @Shehbaz

Users love Wati for ease, Hermes for learning and memory, and Botpress for customisation. Each one's top complaint is a gap another already solves, and none of them checks what its agent promises.

**The product in one line:** an open-source agent workspace for any business. It sets up like Wati from ready-made templates (FAQ, appointments, reminders, CRM, forms and more), learns like Hermes but only with the owner's approval, extends like Botpress without a handover to engineers, and never promises what the owner didn't allow.

**Where it starts:** Ally's AI Chatbots module already provides about a third of it: the engine, the WhatsApp connector, knowledge answering, safety and Preview. The three-stage plan below first upgrades the endpoint to a LangGraph agent with tools, layered memory, a scheduler and a form creator, then completes the platform, with Ally's own teams as the first users.

## Wati Astra

People love how easy Wati is; they resent what it costs and how billing works. Wati holds 4.6/5 from 516 reviews on [G2](https://www.g2.com/products/wati/reviews?qs=pros-and-cons) but 3.0/5 from 274 on [Trustpilot](https://www.trustpilot.com/review/wati.io?page=7). Astra is its separate AI-agent product, sold on its own price list.

**What people love**

- **Ease of use** is the top praise on G2 (102 mentions), with easy setup next (64). Non-technical teams build broadcasts and bots themselves.
- **Official WhatsApp done for you:** template approval, Meta paperwork and onboarding are handled.
- **Astra covers SMB jobs out of the box:** lead qualification, booking, CRM updates and follow-ups across web chat, WhatsApp and voice ([Capterra](https://www.capterra.com/p/10039763/Astra/)).

**What people complain about**

- **Price is the top complaint** (39 G2 mentions), plus 32 saying it's hard on small businesses. A competitor's analysis puts Wati's message rates at about 1.6x Meta's for marketing and 1.8x for utility ([eesel, competitor-published](https://www.eesel.ai/blog/wati-pricing)).
- **Stacked fees:** a $59–149 base plan, Astra at $99–399 on top, AI credits, $40 per 1,000 automation triggers, and $29 per extra number. The same analysis models a US Pro team with Astra at about $668/month.
- **Billing traps:** no self-serve cancel, non-refundable subscriptions, and Trustpilot reports of charges after a cancellation request.
- **Support is inconsistent:** 65 G2 mentions praise it, 16 complain it's hard to reach.

**What to take**

- The bar for ease: a business owner gets a working WhatsApp bot without a developer.
- The opening: zero markup on Meta fees, no credits, one flat open-source core, and cancelling is just turning it off.

## Hermes Agent

People love that Hermes learns and remembers; they distrust what it learns and pay for its instability. It is MIT-licensed, self-hosted Python from Nous Research ([eesel review](https://www.eesel.ai/blog/hermes-agent-review)).

**What people love**

- **The learning loop:** it writes its own notes and drafts reusable skills after repeated tasks, then refines them from feedback. One Hacker News user called it "magical."
- **Layered memory:** two small always-loaded files (`MEMORY.md` capped at 2,200 characters, `USER.md` at 1,375), every past session searchable in SQLite, plus plugins like Mem0 and Honcho ([Composio](https://composio.dev/content/openclaw-vs-hermes-agent)).
- **Portable skills** on the agentskills.io standard; `/learn` turns docs, URLs or workflows into skills.
- **One gateway, 20+ channels,** with the same memory across them, and **cron in plain language** delivered to any of them.

**What people complain about** (ranked from Reddit and X by [AI Agent Store](https://aiagentstore.ai/agentic-ai-and-workflow-automation/en/the-20-biggest-problems-with-hermes-agent-what-thousands-of-reddit-and-x-users-are-actually-struggling-with-ranked))

- **It grades its own failures as successes,** the #1 issue in an analysis of 1,300+ Reddit comments.
- **Learning overwrites hand-tuned skills;** one user called it "a total dealbreaker." Learned skills can also drop hidden conditions.
- **Wrong memories persist** and keep steering later tasks until someone deletes them, and memory and skills can grow without limit.
- **Token weight:** a default install used about 16K tokens for "who u?"; tool schemas were the main cause, and trimming toolsets cut it to about 2.7K ([GitHub issue](https://github.com/NousResearch/hermes-agent/issues/13983)).
- **Instability and setup pain:** 4 major releases in 42 days in one evaluation, and a setup wizard that loops.
- **Not a business product:** no helpdesk, no confidence-based routing, no pre-launch testing on past tickets.

**What to take**

- Learning and layered memory are the magic, and nobody else in this set has them.
- Ungoverned learning is the trap. OpenClaw already answers it with `auto`, `propose` and `off` modes; for businesses the default must be **propose**, with a human approving every change.

## Botpress

People love how far Botpress can be pushed; they hit a code wall within weeks and can't control the bill. It holds 4.5/5 from 516 reviews on [G2](https://www.g2.com/products/Botpress/reviews), and is now cloud-only SaaS.

**What people love**

- **Visual builder plus real code:** drag-and-drop flows, custom JavaScript in a sandbox, API calls, and a code-first Agent Development Kit ([WotNot, competitor-published](https://wotnot.io/blog/botpress-review)).
- **Tables** as structured storage for user records and business data, and a knowledge base trained on docs and websites ([EveryDev](https://www.everydev.ai/tools/botpress)).
- **Build once, deploy everywhere:** web, WhatsApp, Instagram, Messenger, Slack and Telegram, with integrations like HubSpot, Calendly and Zapier.
- **Debuggability:** an event debugger that highlights the active node while testing.

**What people complain about**

- **The code wall:** a non-technical team built a basic bot in hours, needed JavaScript by weeks 2–4, and handed ownership to engineers by month 2.
- **Spend you can't control:** at 95% of quota it auto-buys conversation packs that can't be disabled, and unused packs expire ([DeciderStack](https://deciderstack.com/botpress-review/)). At a 30% resolve rate, Team works out to about $1.67 per resolved conversation.
- **Thin docs and cryptic errors,** and flows that pass in testing but fail in production.
- **Weak human side:** its Desk help-desk layer isn't fully featured yet, and analytics lack CSAT and SLA metrics.
- **No self-hosting:** on-prem and air-gapped deployments are not an option.

**What to take**

- Customisation is loved only when it doesn't force a handover to engineers. The fix is two doors to the same agent: no-code for owners, code for developers, both editing one definition.
- Tables and the event debugger are worth matching; auto-recharge and cloud lock-in are the opening.

## Opportunities

No product combines learning that the business controls with Wati's ease and Botpress's depth, at Meta's cost and on your own server. Each of the three is strong in one column and weak in the others.

| What a business needs | Wati Astra | Hermes Agent | Botpress |
| --- | --- | --- | --- |
| Setup without a developer | Yes, its main strength | No: CLI, looping setup wizard | Hours for basics, code by week 2–4 |
| Learns from real use | Tone and intents from past chats | Yes, but ungoverned and self-graded | No |
| Memory per customer that staff can see and fix | Not described | Personal, one user | Partly, via Tables |
| No-code and code edit the same agent | No-code only | Config and code only | Both, but code takes over |
| Self-hosted, official WhatsApp, no markup | No: about 1.2–1.8x Meta rates | Self-hosted, but a personal agent | No: cloud-only |
| Spend you control | Credits, add-ons, no self-serve cancel | Token-heavy by default | Auto-recharge you can't turn off |
| Changes tested before they ship | Not described | Grades its own failures as passes | Passes tests, fails in production |
| Human inbox and handoff | Yes | No | Partly: Desk incomplete |
| Promises checked before sending | No | No | No |

The last row is empty for all three, and it's the failure that ends up in court, as the earlier research showed. Every other row is a known pain with a known fix that nobody has combined.

## The product

**Positioning:** an open-source agent workspace that is as easy as Wati, learns like Hermes, extends like Botpress, and never promises what the owner didn't allow. It runs on your server or ours, on official WhatsApp at Meta's price.

Seven principles decide every design choice:

1. **Owner first.** A business owner goes from WhatsApp number to working agent in 15 minutes, starting from templates, and runs it day to day by chatting with it. *(Wati's ease.)*
2. **It learns, but it asks.** Every lesson becomes a proposal with evidence; nothing changes the agent until someone approves it. Hand-tuned parts are locked. *(Hermes's loop, fixed.)*
3. **One definition, two doors.** Studio for owners and YAML or SDK for developers edit the same agent, so customising never forces a handover. *(Botpress's depth, fixed.)*
4. **The database decides, the model phrases.** Fees, hours and slots come from typed data; the model only words the answer.
5. **Nothing ships blind.** Every change, learned or manual, is replayed on real past chats before it goes live, and success is measured by outcomes and staff acceptance, never by the agent grading itself.
6. **Accountable by default.** Every reply passes a commitment check; every promise gets an owner, a deadline and a receipt.
7. **Your cost, your box.** Self-host or use our cloud, bring your own model key, pay Meta directly, and set hard spending caps. No credits, no auto-recharge, no markup.

## Core features

Ten features, each taking what users love in one product and fixing what they hate in another.

1. **15-minute setup**
   - Connect WhatsApp, paste a website or Google listing, and optionally upload an exported WhatsApp chat history.
   - The system drafts facts, FAQs, hours, fees and the decisions staff make ("new booking or reschedule?"), and the owner approves them on one review screen.
   - Templates (FAQ, appointments, reminders, CRM, forms and more) install the rest; see Templates below.
2. **Owner copilot on WhatsApp**
   - The owner teaches by chat ("we're closed tomorrow", "this service now costs ₹800"); the agent confirms in one line before changing anything.
   - A 9 pm digest lists bookings, open promises and questions it couldn't answer, each with a reply-to-teach button.
   - Approvals arrive as one-tap buttons.
3. **Layered memory the business can see**
   - **Business brain:** typed facts and dated rules, looked up by key.
   - **Customer memory:** a card per contact with whitelisted fields (name, language, preferred times) plus short summaries of past conversations, all searchable.
   - Staff can view, correct or delete any memory; forbidden fields like diagnoses are rejected by the schema; every memory can carry an expiry date.
4. **Governed learning loop**
   - Signals: staff edits to drafts, takeovers and their reasons, repeated unanswered questions, customer contradictions ("your site says ₹500").
   - Each becomes a proposal (new fact, FAQ or skill change) with the chats that triggered it and its replay result.
   - Modes per area: `propose` (default), `auto` for low-risk areas the owner trusts, `off`. Locked skills are never overwritten.
5. **Skills, including forms**
   - Portable packages compatible with the agentskills.io standard, plus a UI part and declared permissions.
   - Skills ship inside templates (see Templates below); forms can be filled by chat, by Hinglish voice note, or as a WhatsApp Flow on mobile.
   - A skill creator: describe it in plain words, get the package, its form and its tests to review.
6. **Schedules that respect WhatsApp's rules**
   - Set in plain language ("remind patients a day before", "report every Sunday at 9").
   - Tied to events, not only clocks: X hours before an appointment, Y days after a visit.
   - Picks approved templates outside the 24-hour window; every run is logged and failures raise an alert.
7. **Connectors that don't bloat**
   - MCP servers, any OpenAPI URL, and built-ins for Google Calendar, Cal.com, Sheets, Razorpay and HubSpot.
   - Tools load only when needed, so a simple question doesn't carry thousands of tokens of tool descriptions.
   - Each connector has a permission scope and a risk level.
8. **Two doors, one definition**
   - Studio for owners and agencies; `workspace.yaml` plus a TypeScript or Python SDK for developers.
   - Both edit the same versioned definition, so neither side's changes are lost; history lives in Git.
   - A step-by-step trace of every conversation, like Botpress's debugger but on live traffic too.
9. **Trust layer**
   - Commitment firewall: prices, discounts, dates and promises in each draft reply are checked against the owner's mandate before sending.
   - Promise ledger: "we'll call you back" becomes a task with an owner, deadline and receipt.
   - Earned autonomy: each decision moves from shadow to draft to automatic only on measured staff acceptance, and drops back automatically after a model change.
10. **Inbox and proof**
    - A shared inbox with AI handoff summaries (built in, or Chatwoot), usable on a cheap Android phone.
    - A proof page: bookings, recovered no-shows, promises kept on time and cost per outcome, labelled as estimates with inputs shown.
    - Hard monthly caps per workspace; when a cap is hit, the agent hands over to staff instead of going silent.

## Templates

Every business capability is a template you install, not code you write. A template bundles skills, data tables, schedules, quick replies, decision defaults, setup questions and tests, and any working agent can be saved as a new template.

**Building-block templates** each do one job and combine freely. Safety (crisis check, consent, rate limits) is not a template: it is always on, and templates can only tighten it.

| Template | What the agent can do | What it installs |
| --- | --- | --- |
| FAQ and knowledge | Answer from documents and typed facts, decline when unsure, log gaps | Knowledge picker, facts table, quick replies, gap log |
| Appointments | Find slots, book, reschedule and cancel, saying the change back before acting | Booking skill, calendar connector (Google Calendar or Cal.com), services and staff tables, the "new or move?" decision |
| Scheduling and reminders | Send reminders, follow-ups and recurring messages within WhatsApp's template rules | Routines tied to events or clocks, message templates, opt-out handling |
| Customer relationship (CRM) | Remember each contact, tag and stage them, create follow-up tasks, sync to a CRM | Contact profile fields, tags, pipeline stages, tasks, HubSpot or Sheets connector |
| Forms and intake | Collect details by chat, voice note or WhatsApp Flow, validate and save them | Form builder skill, form definitions, submissions table |
| Lead qualification | Ask scored questions, rank the lead, route hot leads to a person | Scoring skill, rubric, routing rules |
| Payments | Send a payment link, confirm payment, update the record | Razorpay or Stripe connector, invoices table |
| Feedback and reviews | Ask for a rating after a visit; route unhappy customers to the owner first | Survey skill, review link, a routine N hours after a visit |
| Handoff and inbox | Hand over with a summary, track who owns each chat, alert on overdue replies | Inbox, assignment, reply-time alerts |
| Broadcasts | Send opted-in announcements to a segment | Segments, campaign skill, approved templates |

**Starter packs** are building blocks bundled with sample data for one kind of business:

| Starter pack | Templates included |
| --- | --- |
| Clinic or therapy practice | FAQ, Appointments, Scheduling, Forms (intake), Lead qualification set up as screening, with scores going to staff only |
| Salon or spa | FAQ, Appointments, Scheduling, Feedback, Broadcasts |
| Online store | FAQ, CRM, Payments, Broadcasts, plus a custom order-status skill |
| Coaching or education | FAQ, Lead qualification, Appointments (demo class), Payments, Scheduling |
| Real estate | FAQ, Lead qualification, Appointments (site visits), CRM |
| Internal helpdesk | FAQ, Forms (requests), Handoff, on Slack |

**What a template is made of.** One folder with a `template.yaml` manifest, its skills and its tests:

```yaml
name: appointments
version: 1.2.0
requires:
  connectors: [calendar]
provides:
  tables: [services, staff, appointments]
  events: [appointment.created, appointment.moved, appointment.cancelled]
setup:                      # asked once, in plain words, at install
  - What services do you offer, and how long does each take?
  - Who takes appointments, and on which days?
installs:
  skills: [find_slots, book, reschedule, cancel]
  decisions:
    booking.new_vs_move: { authority: decide, requires: say_it_back }
    booking.same_day: { authority: propose }
  quick_replies: [hours, location]
tests: tests/*.yaml         # must pass before install and before every upgrade
```

**How templates combine.** A template declares what it `provides` and what it `uses`. Scheduling uses the `appointment.created` event that Appointments provides, so installing both gives reminders with no extra setup; installing Scheduling alone gives clock-based routines only.

**Customising without breaking upgrades.** This is the same model as today's settings and quick replies: the template supplies defaults and the workspace's changes sit on top. A new template version shows a diff, keeps local changes, and asks only when both sides changed the same thing. As today, a workspace can reword anything but can only tighten safety.

**Creating your own template**, three ways:

1. **Save as template:** any working agent becomes a template. Contacts, conversations and secrets are stripped; tables' structure, skills, schedules, instructions and tests are kept.
2. **Template Studio:** combine building blocks and custom skills. Describe a new skill in plain words and the skill creator drafts it, with its form and tests, for review.
3. **In code:** write `template.yaml` and the skills in a repo and publish from the command line.

Templates can be shared privately, across an organisation, with an agency's clients, or in a public registry. Public templates are signed, reviewed and must pass their own tests before they are listed.

## Architecture overview

[Diagram not included in this export: architecture · 7 layers, trust layer and learning loop highlighted]

A message enters through the gateway, the harness drafts a reply using memory, connectors and skills, and the trust layer checks it before it goes out. Lessons from staff flow back only through the learning loop, after replay testing and owner approval.

## Starting point: what's already built

About a third of the platform already exists in Ally's AI Chatbots module, and its core ideas are the right ones to keep: a chatbot is configuration, a connector is a way in, and one channel-agnostic engine decides every reply ([build doc](https://claude.ai/artifact/MSwmsu57XFYeNphiF6vHnD)). What's missing is everything that lets the agent *act*: tools, memory, schedules and templates.

| Capability | Built today | Keep or change | Still to build |
| --- | --- | --- | --- |
| Agent as configuration | `chatbots` table: status, persona, answer mode, model, settings overrides | Keep; rename to agents later | Template instances, decisions, roles per sender |
| Channels | Connector registry; WhatsApp with per-number webhook, encrypted credentials, SQS queue, dedupe, STOP/START | Keep as is | Web widget, Slack, Instagram; Embedded Signup |
| Engine | `ChatbotEngineService.respond`: quick replies, then access, then answer; never sends, so Preview runs the real path | Keep the "engine decides, channel sends" rule | A tool-calling step, memory read and write, a commitment check before send |
| Knowledge | ally-ai knowledge agent: translate, Weaviate search scoped to the bot's documents, decline in code below a threshold, citations | Becomes the FAQ template's core | Typed facts table looked up by key, so fees and hours never come from search |
| Quick replies | `wa_keyword_templates` with shared defaults and per-bot overrides | Becomes part of templates | Move into the template installer |
| Safety | Crisis keywords plus AI crisis check, consent, rate limits; a bot can only tighten them | Keep; the "only tighten" rule becomes a platform rule for every template | Commitment firewall and promise ledger on top |
| Access | Anyone, recognised users, or a listed audience; team roles viewer, editor, owner | Keep | Staff and admin roles recognised from the sender, for the owner copilot |
| Testing | Preview via `POST /v1/chatbots/:id/test`, sets `last_tested_at` | Keep; it's the seed of the simulator | Golden chats per template, replay of past chats before publish |
| Learning | Declines filed to `wa_unanswered_questions` (Knowledge gaps) | Keep as the first learning signal | Gaps grouped into proposals with owner approval |
| Conversations | Stored in WhatsApp-specific tables | Change: needed for any second channel and for memory | Shared, channel-agnostic contacts, conversations and messages |
| Not started | — | — | Tools and connectors to other systems, contact memory, schedules, forms, CRM, payments, inbox and handoff, templates |

Two open items from the build doc come first, because everything later builds on them: publish the v2 crisis and answer prompts in production, and prove "documents + general knowledge" end to end in Preview.

## What makes it world-class

The individual parts exist elsewhere; what doesn't exist is an agent that learns and acts while staying provably under the owner's control. Three pieces carry that claim.

- **Governed learning.** Hermes proved people want agents that improve themselves, and its users' top complaints are self-grading and overwritten skills. Proposals with evidence, replay testing and owner approval turn that magic into something a business can trust.
- **Commitment firewall plus promise ledger.** None of the three checks what a reply promises. This is the feature that answers the Air Canada and warranty-payout failures.
- **Two doors on one definition.** Botpress's biggest complaint is the handover to engineers. Keeping Studio and code in sync means a business owner and a developer can work on the same agent.

**Honest risks**

- **Meta's own Business Agent is free.** Simple FAQ bots aren't a market; the wedge has to be control, integrations and trust.
- **Wati can copy features** and already has distribution. Being open source, self-hostable and markup-free is harder for it to copy than any single feature.
- **Governed learning is hard to get right.** Too many proposals and owners stop reading them; the daily digest must group them and show only the few that matter.
- **The commitment firewall will miss things.** Treat it like a spam filter: measure its catch rate on a red-team set and publish it.
- **Open-source projects die without income.** Plan the business early: managed cloud, support, and verified templates.

**The test of world-class:** two very different businesses (say, a salon and an online store) run on the same engine through templates alone, with zero code changes, and the firewall catches every unauthorised promise in a public red-team set.

## Three-stage build

[Diagram not included in this export: three-stage build · 26 weeks after Stage 1, 3 gates]

The build has three stages. Stage 1 is live: teams configure their own chatbots. Stage 2 upgrades the ally-ai endpoint to a LangGraph agent that can use tools, remember, follow layered context, run on schedules and create forms. Stage 3 adds templates, the trust layer and everything else in this doc. Each stage starts once the gate before it passes; week counts assume two to three engineers.

### Stage 1: live today

Teams can already create a chatbot, give it instructions and a tone, attach knowledge documents, set who may chat, customise quick replies, connect a WhatsApp number, test in Preview, and review conversations, knowledge gaps and analytics. Safety (crisis keywords, the AI crisis check, consent, rate limits) is on for every bot and can only be tightened.

Finish these before Stage 2 starts, because Stage 2 is measured against Stage 1:

- [ ] Publish v2 of the crisis-check and answer prompts in production
- [ ] Prove "documents + general knowledge" end to end in Preview
- [ ] Add user search to Access → Team
- [ ] Scope the knowledge picker and citations by bot membership
- [ ] Save 50 real questions from Preview and Knowledge gaps, with today's answers, as the parity set for Stage 2

### Stage 2: an agent that can act (weeks 1–10)

Upgrade the ally-ai endpoint to a LangGraph agent while ally-be's engine, connectors and safety stay exactly as they are. Prove parity first, then add one capability at a time, each behind a per-bot switch.

**Design rules**

- **Same contract, switchable runtime.** ally-be keeps calling one ally-ai endpoint; a per-bot setting `runtime: v1 | v2` picks the pipeline, so rollback is a settings change, not a deploy.
- **ally-be still goes first.** Quick replies, access, kill switches, consent and crisis keywords run before the graph; the AI crisis check keeps running in parallel.
- **The graph decides, ally-be executes.** Tools are thin stubs that call an ally-be gateway with a token scoped to one bot and one contact, so credentials never reach ally-ai.
- **Deterministic where it matters.** The decline gate and citation mapping stay in code, as graph nodes.

| # | Step | What it involves | Done when |
| --- | --- | --- | --- |
| 1 | LangGraph parity | Rebuild translate, search, gate, select, write and check as graph nodes; run v1 and v2 side by side on the parity set | v2 matches or beats v1 on the 50 questions; crisis behaviour unchanged |
| 2 | Threads and checkpoints | Thread id = conversation id; LangGraph's Postgres checkpointer; Preview uses throwaway threads | A follow-up ("and on Sunday?") is answered in context |
| 3 | Layered context files | A virtual filesystem of .md layers served by ally-be (next sections); editors in the dashboard; every file versioned | Editing ORG.md changes answers with no deploy |
| 4 | Tool gateway and first tools | `tools` registry and `agent_tools` allowlist in ally-be; gateway endpoint; first tools: facts lookup from data tables, handoff; risky tools pause with a LangGraph interrupt and resume on the person's reply | Tool calls show in Preview with inputs, outputs and timing |
| 5 | Contact memory | Each contact's USER.md, written through a memory tool, allowed fields only, with expiry; staff can view, edit and delete it in Conversations | A returning contact is remembered; a forbidden field is rejected |
| 6 | Scheduler | `scheduled_jobs` plus a worker every minute that queues due jobs on SQS; job types: send a template, wake the agent, send a digest; schedule tools for admins and the agent; the 24-hour rule enforced at send | A reminder set in chat fires on time, once, even after a restart |
| 7 | Form creator | `forms` and `form_submissions`; a dashboard builder with live preview; tools to create and edit a form by chat, and to fill one in conversation, one field at a time with validation | A lead form built by chat is filled on WhatsApp and lands in submissions |
| 8 | Tracing | A LangSmith or Langfuse trace per run, linked from Preview and Conversations | Any reply can be explained step by step |

**Gate to Stage 3:** the Ally FAQ bot runs on v2 with no regressions, and an internal lead-capture agent uses memory, a form, a scheduled follow-up and handoff end to end.

[Diagram not included in this export: Stage 2 runtime · ally-be and the LangGraph agent]

ally-be runs quick replies, access and safety first, then starts a run. The graph loads the layered files through ally-be, calls tools that ally-be executes, pauses for approval on risky ones, and returns a decision that ally-be sends. The scheduler starts runs on its own clock through the same engine.

### Layered context files

Every run assembles a small set of markdown files in layers; higher layers win, and the agent can write only to the contact and scratch layers.

| Layer | File | Who writes it | When it loads | What it holds |
| --- | --- | --- | --- | --- |
| Platform | `/platform/SAFETY.md` | Platform admins | Always; locked | Crisis rules, consent, what no bot may do |
| Organisation | `/org/ORG.md` | Organisation admins | Always | Who the organisation is, tone, policies |
| Agent | `/agent/AGENT.md` | Bot editors; today's instructions move here | Always | Persona, goals, how to handle each decision |
| Role | `/roles/<role>.md` | Bot editors | For the sender's role | How to treat a customer, staff member or admin |
| Skills | `/skills/<name>/SKILL.md` | Template maintainers | Only when relevant | How to run a form, a booking, a follow-up |
| Contact | `/contacts/<id>/USER.md` | The agent (allowed fields only) and staff | For that contact | Name, language, preferences, open items |
| Scratch | `/scratch/` | The agent | This conversation only | Working notes, large tool results |

**Rules**

- **Facts stay out of files.** Fees, hours and slots live in data tables, so the same question always gets the same answer.
- **Small, capped files.** Always-loaded layers have size limits, as Hermes caps its memory files; a file over its limit gets a summarising proposal instead of being cut silently.
- **Precedence:** platform, then organisation, agent, role and contact, the same "safety only tightens" rule ally-be applies today.
- **Implementation:** a custom Deep Agents backend that reads and writes through ally-be, with writes denied everywhere except the current contact's USER.md and scratch ([Deep Agents backends](https://docs.langchain.com/oss/python/deepagents/backends)). ally-be stays the source of truth and keeps every version. In Stage 3, agent edits to higher layers arrive as proposals.

### Stage 2 detail: the graph

One LangGraph graph serves every bot; per-bot feature flags switch nodes on, so parity mode is simply the same graph with everything new turned off.

**State** carried through a run (and checkpointed per conversation):

```python
class AgentState(TypedDict):
    bot_id: str
    bot_version: int
    conversation_id: str          # also the LangGraph thread_id
    contact_id: str
    role: Literal["customer", "staff", "admin"]
    message: str                  # original text
    message_en: str               # translated for search
    language: str
    context: dict[str, str]       # loaded .md layers, by path
    passages: list[Passage]       # retrieved, with scores
    messages: list[AnyMessage]    # model and tool turns this run
    steps: int                    # tool-loop counter
    decision: Literal["answer", "decline", "clarify", "handoff", "pending_approval"]
    text: str
    citations: list[Citation]
    memory_writes: list[MemoryWrite]
```

**Nodes**, in order:

| Node | What it does | Today's equivalent | Flag |
| --- | --- | --- | --- |
| `load_context` | Fetches the .md layers for this bot, role and contact through the gateway; cached per bot version | Persona block | `context_files` (off = persona only) |
| `translate` | Restates the question in English for search | translate\_query prompt | always |
| `retrieve` | Searches Weaviate, pre-filtered to the bot's documents | Same | always |
| `gate` | Declines in code below the threshold, unless general-knowledge mode | Same | always |
| `agent` | The model call: layers, passages, skills index and allowed tools; returns an answer or tool calls | whatsapp\_answer prompt | always |
| `tools` | Runs each tool call through the gateway and adds results | None | `tools` |
| `approval` | Pauses with a LangGraph interrupt when a tool is marked risky; resumes on the person's reply | None | `tools` |
| `check` | Maps citations to chunks, turns an empty answer into a decline | Same | always |
| `finalize` | Sends memory writes through the gateway and returns the decision | None | `memory` |

**Edges:** `agent` goes to `tools` when it requests a tool, otherwise to `check`. `tools` goes to `approval` when the tool needs a yes, otherwise back to `agent`. After 4 tool steps the run stops and hands off to a person. `search_knowledge` is also exposed as a tool, so the agent can search again with a better query.

**Feature flags per bot** (`features` in settings): `context_files`, `tools`, `memory`, `schedules`, `forms`. Each can be turned on for one bot at a time, and the parity set is re-run after each.

### Stage 2 detail: endpoint and gateway

ally-be calls one new ally-ai endpoint for v2 bots and keeps calling `/knowledge-agent/answer` for v1 bots; the crisis check stays a separate call that runs in parallel, unchanged.

**`POST /agent/run`** (ally-ai):

```json
{
  "bot_id": "…", "bot_version": 12, "conversation_id": "…",
  "contact": { "id": "…", "role": "customer", "recognised": true },
  "message": { "text": "…", "lang": "hi" },
  "documents": ["…"], "answer_mode": "documents_only",
  "model": { "name": "…" }, "settings": { … },
  "features": { "context_files": true, "tools": true, "memory": false },
  "run_token": "…",
  "resume": { "interrupt_id": "…", "value": "yes" }
}
```

It returns `decision`, `text`, `citations`, `retrieval`, `tool_calls` (name, inputs, a short result, timing), an optional `approval` (prompt and button options when the run paused), `memory_writes`, an optional `knowledge_gap`, an optional `alert` and a `trace_url`. When `decision` is `pending_approval`, ally-be sends the buttons and calls the endpoint again with `resume` when the person replies.

**Gateway** (ally-be, internal routes only):

| Route | Purpose |
| --- | --- |
| `GET /internal/agent/context` | The .md layers for a bot, role and contact, with versions |
| `POST /internal/agent/tools/:name` | Executes one tool call and records it in `tool_runs` |
| `PUT /internal/agent/contacts/:id/memory` | Writes allowed memory fields; rejects anything else |

**Security:** every call carries a service secret plus the per-run `run_token`, a short-lived token naming the bot, contact, conversation and allowed tools. Each tool call has an idempotency key (run id plus step), so a retried run never books or sends twice. Credentials for calendars, CRMs and WhatsApp never leave ally-be.

### Stage 2 detail: data model

All new business data lives in ally-be's Postgres as ordinary migrations, keyed by `chatbot_id` like today's tables; only LangGraph's own checkpoint tables live on the ally-ai side.

| Table | One row is | Key columns | Step |
| --- | --- | --- | --- |
| `chatbots` (changed) | A bot | + `runtime` (v1, v2), + `features` (jsonb) | 1 |
| `context_files` | One .md layer | `scope` (platform, org, agent, role), `scope_id`, `path`, `content`, `version`, `updated_by` | 3 |
| `context_file_versions` | A past version | `file_id`, `version`, `content`, `updated_by`, `created_at` | 3 |
| `data_tables`, `data_rows` | A facts table and its rows | table `schema` (jsonb); row `key`, `values` (jsonb) | 4 |
| `tools` | A tool | `name`, `kind` (built-in, HTTP, MCP), `schema`, `config_enc`, `risk` (low, medium, high), `confirm` rule | 4 |
| `chatbot_tools` | A tool enabled on a bot | `chatbot_id`, `tool_id`, `enabled` | 4 |
| `tool_runs` | One tool call | `run_id`, `step`, `tool`, `args`, `result`, `status`, `ms`, `idempotency_key` | 4 |
| `contact_memory` | What a bot remembers about a contact | `chatbot_id`, `contact_id`, `fields` (jsonb), `summary`, `expires_at`, `updated_by` (agent, staff) | 5 |
| `scheduled_jobs` | A job to run later | `chatbot_id`, `contact_id`, `kind` (send template, wake agent, digest), `run_at`, `payload`, `status`, `attempts`, `idempotency_key`, `created_by` | 6 |
| `forms` | A form | `chatbot_id`, `name`, `schema` (fields, types, required, validation), `version`, `status` | 7 |
| `form_submissions` | One person's answers | `form_id`, `contact_id`, `conversation_id`, `answers` (jsonb), `status` (partial, complete) | 7 |

A migration in step 3 copies each bot's persona instructions into its `AGENT.md`, so nothing is lost and v1 keeps reading the old field until the bot switches. Allowed memory fields are declared per bot in `settings`, and the gateway rejects writes to any other field.

### Stage 2 detail: dashboard

The existing chatbot page gains four tabs and upgrades three; access stays as today (viewers look, editors change, owners manage).

| Where | Change | Step |
| --- | --- | --- |
| Settings | Runtime switch (v1, v2) and feature toggles, platform admins only at first | 1 |
| Preview | A step panel: each node, tool call and timing, a link to the trace, and a "new thread" button | 1, 8 |
| Instructions → **Context** (renamed) | Editors for AGENT.md and role files; ORG.md for organisation admins; SAFETY.md read-only except for platform admins; version history with diff and restore | 3 |
| **Data** (new) | Facts tables: define columns, edit rows, import CSV | 4 |
| **Tools** (new) | Enable tools, set risk level and confirm rule, see recent tool runs | 4 |
| Conversations | A memory card per contact (view, edit, delete), tool calls inline in the thread | 5 |
| **Schedules** (new) | Upcoming and past jobs, create and cancel, failures highlighted | 6 |
| **Forms** (new) | Builder with live preview, submissions table, CSV export | 7 |

The setup checklist on Overview gains items as features are switched on, for example "run Preview after enabling tools".

### Stage 2 detail: week by week

[Diagram not included in this export: Stage 2 week by week · ally-ai, ally-be, ally-web]

The three repos move in parallel against the step numbers above: ally-ai builds the graph, ally-be builds the gateway and stores, and ally-web adds a tab as each feature lands. The Ally FAQ bot switches to v2 at week 5, halfway through, so most of Stage 2 is tested on real traffic.

### Stage 2 detail: testing, rollout and rollback

No real person talks to v2 until it has matched v1 on recorded questions and then run silently beside it on live traffic.

**Parity test** (the 50-question set from Stage 1, re-run after every step):

| Measure | Pass mark |
| --- | --- |
| Answer or decline matches v1 | 95% or more; every difference reviewed by a person |
| Citations | The same documents cited in at least 90% of answers |
| Language | Reply in the asker's language every time |
| Crisis behaviour | Identical to v1 on every crisis and near-crisis question |
| Latency | p90 no more than 2 seconds slower than v1 (today 5–12 seconds end to end) |
| Cost per answer | Within 25% of v1 in parity mode |

**Other tests:** unit tests per graph node; contract tests on `/agent/run`; gateway tests that a token can't reach another bot's tools, that a forbidden memory field is rejected, and that a repeated tool call runs once; and a scheduler test that jobs survive a restart.

**Rollout, one bot at a time:**

1. **Preview only:** v2 runs only in Preview for the Ally FAQ bot.
2. **Shadow, one week:** on live traffic v2 runs beside v1, v1 still replies, and both answers are logged for comparison.
3. **Switch:** the Ally FAQ bot moves to v2 with `context_files` on.
4. **Features:** the lead-capture bot turns on `tools`, `memory`, `schedules` and `forms` one at a time, a few days apart.

**Rollback:** setting a bot's runtime back to v1 takes effect on its next message; a platform-wide switch sends every bot back to v1 at once. Scheduled jobs and forms keep their data and simply pause on v1 bots.

### Stage 2 detail: risks and open decisions

The biggest risk is slower, costlier replies; every extra model call and tool step adds seconds to a reply that already takes 5–12.

| Risk | Mitigation |
| --- | --- |
| Latency grows with tool steps | Cap at 4 steps; send a WhatsApp typing indicator; load context once per bot version; keep `translate` and `retrieve` parallel with the crisis check |
| Token cost from context and tool descriptions | Size caps on always-loaded files; only the bot's allowed tools are described; skills load only when relevant |
| The agent writes wrong memories | Allowed fields only, expiry dates, staff can see and delete every memory, and memory writes are logged |
| A tool acts twice after a retry | Idempotency key per tool call, checked in `tool_runs` before running |
| Scheduled messages break WhatsApp's rules | The 24-hour rule and approved templates are enforced in ally-be at send time, not in the agent |
| Two code paths drift apart | v1 is frozen once v2 passes parity; fixes go to v2 only; v1 is removed at the start of Stage 3 |

**Decisions to make before week 1**

- [ ] Python version of LangGraph inside ally-ai (fits today's stack) or a separate service
- [ ] Tracing: LangSmith or self-hosted Langfuse
- [ ] Where LangGraph's checkpoint tables live: ally-ai's own database or a schema in the shared Postgres
- [ ] Which allowed memory fields the lead-capture bot needs
- [ ] Who owns the lead-capture bot on the business side

### Stage 3: the complete platform (weeks 11–26)

Stage 3 turns the agent into the full workspace described above, in an order where each step builds on the one before.

| # | Step | Builds on | Done when |
| --- | --- | --- | --- |
| 1 | Shared conversation store and web widget | Stage 2 threads | The same agent and memory answer on WhatsApp and the web |
| 2 | Template format, installer and gallery; FAQ migrated to a template | Context files, tools | The Ally FAQ bot is a template install with unchanged answers |
| 3 | Templates: Appointments, Scheduling and reminders, CRM, Forms with WhatsApp Flows, Lead qualification, Payments | Installer, scheduler, form creator | Each passes its golden chats; the demo-booking agent is live |
| 4 | Golden chats and replay gate | Preview, checkpoints | Publishing is blocked while a golden chat fails |
| 5 | Decisions, commitment check, promise ledger | Tools, scheduler | Catch rate on a 100-message red-team set is measured and published |
| 6 | Inbox and handoff; owner copilot | Roles, scheduler | Staff take over and hand back; an owner updates facts by chat |
| 7 | Governed learning: proposals from gaps, edits and takeovers | Knowledge gaps, context files, replay | Approved proposals change the agent through the override layer |
| 8 | Save as template, Template Studio, skill creator | Templates | A new template is built without code and passes its tests |
| 9 | Slack and Instagram connectors; Embedded Signup | Connector registry | A business connects WhatsApp without manual Meta setup |
| 10 | Proof page and spend caps; open-source release and template registry | Everything above | An outside team runs a different kind of business with no code changes |

## Using it internally at Ally

Ally should be the platform's first customer: every template runs on an internal agent for at least two weeks before any outside business gets it. Internal agents are low-risk places to find bugs, and they give real conversations to build golden chats from.

| Order | Internal agent | Who it serves | Templates | Channel | Stage | Success looks like |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Ally FAQ | Anyone asking about Ally | FAQ | WhatsApp (already drafted) | Stage 2, first bot on LangGraph | Decline rate falls week on week as gaps are closed |
| 2 | Lead capture | Inbound prospects | Forms, memory, scheduled follow-up, handoff | WhatsApp | Stage 2 gate | Every qualified lead lands in submissions with a follow-up |
| 3 | Demo booking | Organisations considering Ally | Appointments, Scheduling | WhatsApp, website | Stage 3 | Demos booked without a sales rep; no double bookings |
| 4 | Customer success | Admins at client organisations | FAQ, CRM, Handoff, Forms (requests) | WhatsApp | Stage 3 | Fewer tickets reach the team; every promise kept on time |
| 5 | Team helpdesk | Ally's own staff (HR, IT, product questions) | FAQ, Forms, Handoff | Slack | Stage 3 | Proves a second channel and shared memory |

Who owns which agent should be decided per row; the business owner (sales for 2 and 3, customer success for 4) owns the agent, not engineering.

**Roles**

- **Agent owner** (a business person): sets decisions, approves proposals, reads the daily digest.
- **Reviewer** (support or ops): works the inbox; their edits to drafts are the main learning signal.
- **Template maintainer** (engineering): owns a template's code, tests and upgrades.
- **Platform admin:** owns defaults, safety settings and channels, as today.

**Operating rhythm**

- **Every change**, including prompt edits: Preview, then golden chats, then replay, then publish. Nothing is edited straight in production; this closes the gap behind today's "prompt published locally only" issue.
- **Daily:** each owner gets a digest of open promises, handoffs and unanswered questions.
- **Weekly, 30 minutes per agent:** clear the proposal queue, turn the week's worst conversation into a golden chat, and check five numbers: answer rate, decline rate, handoff rate, promises kept on time, and cost per conversation.
- **Monthly:** release templates. Internal agents upgrade first and act as the canary for outside customers.

## Sources

Several pricing analyses are published by competitors of the product they review; they are marked where used above.

- [G2: Wati pros and cons](https://www.g2.com/products/wati/reviews?qs=pros-and-cons)
- [Trustpilot: Wati reviews](https://www.trustpilot.com/review/wati.io?page=7)
- [Capterra: Astra by Wati](https://www.capterra.com/p/10039763/Astra/)
- [eesel: Wati pricing 2026 (competitor)](https://www.eesel.ai/blog/wati-pricing)
- [SleekFlow: Wati Astra review (competitor)](https://sleekflow.io/blog/wati-astra-ai-review)
- [eesel: Hermes Agent review](https://www.eesel.ai/blog/hermes-agent-review)
- [AI Agent Store: 20 biggest problems with Hermes Agent](https://aiagentstore.ai/agentic-ai-and-workflow-automation/en/the-20-biggest-problems-with-hermes-agent-what-thousands-of-reddit-and-x-users-are-actually-struggling-with-ranked)
- [Composio: OpenClaw vs Hermes Agent](https://composio.dev/content/openclaw-vs-hermes-agent)
- [GitHub: Hermes default token consumption issue](https://github.com/NousResearch/hermes-agent/issues/13983)
- [G2: Botpress reviews](https://www.g2.com/products/Botpress/reviews)
- [WotNot: Botpress review (competitor)](https://wotnot.io/blog/botpress-review)
- [DeciderStack: Botpress pricing math](https://deciderstack.com/botpress-review/)
- [EveryDev: Botpress features](https://www.everydev.ai/tools/botpress)

* [LangChain: Deep Agents backends](https://docs.langchain.com/oss/python/deepagents/backends)
* [Ally: AI Chatbots implementation and data flow](https://claude.ai/artifact/MSwmsu57XFYeNphiF6vHnD)
