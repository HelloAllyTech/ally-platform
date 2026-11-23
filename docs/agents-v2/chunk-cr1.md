# Chunk CR1 — Costs, models, tokens, plans and seats

> Brief for Claude Code. Read `CONTEXT.md`, `FINAL-PLAN.md`, `CHUNK-A1-NOTES.md` (owners, members, custom logins), `CHUNK-12B-NOTES.md` (the bot page's daily cap and rate limits), `CHUNK-03B-NOTES.md` (run ids, `tool_runs`), `WA-NUMBERS-REPORT.md`, then this file. Plan first. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-cr1` from master. Tag commits `[CR1]`. Repos: all three. Build in this order, one commit group each: **A** costs and models, **B** custom logins and tokens, **C** plans and seats.
> **Stops:** (1) the plan, with the **metering map** (every place an AI call or paid service is used today), the starting **model list and prices**, and the starting plan and seat numbers (table at the end); (2) screenshots at 1440 and 390 of Ally admin → Models, → Costs, → Plans, a user's Tokens and Plan, and the owner's Plan and usage. About 3.5 days.
>
> Replaces the separate CR1 and CR2 briefs (19 Nov). **Customers never see dollars.** Only Ally super admins see costs.

## Decided (Shehbaz and team, 19 Nov)

- **Track what every assistant really costs Ally,** in US dollars, from a list of models and prices Ally admins manage.
- **Ally admins manage the models:** see each model with its price per million tokens, add newer models, update prices, retire or delete them.
- **Custom logins become a limited role** with a **token allowance** Ally admins assign, update, revoke or delete.
- **Chatbot creators have a plan** (only they do): **Free** publishes up to 3 assistants, **Pro** more.
- **Each published assistant has seats** for invited people: 5 included, more bought monthly, each **Basic** or **Premium**, each with its own start date and renewal. Public and WhatsApp customers aren't seats; they use a **monthly conversation allowance** per assistant from the plan.
- **Ally assigns** plans, seats and tokens in this version. Online payment comes later (Phase 3, block 16).
- **At any limit, assistants pause politely, and crisis replies always go out.**

---

## Part A — Costs and models

### A1. Ally admin → Models (super admins only, checked on the server)

A table of every model Ally can use:

| Field | Example |
|---|---|
| Provider | OpenAI, Anthropic, Google, Cohere |
| Model id (as the provider names it) | `gpt-4.1-mini` |
| Display name | GPT-4.1 mini |
| Type | chat, embedding, classifier, transcription |
| Input $ per million tokens | 0.40 |
| Cached input $ per million | 0.10 |
| Output $ per million tokens | 1.60 |
| Other unit price (per page, per minute) | optional |
| Status | active, retired |
| Price effective from | date |
| Notes | "new default for customer replies" |

- **Add a model:** for a newer model, fill in the fields. It's priced from its effective date.
- **Update a price:** saves a **new version** effective from a date (today by default). Old usage keeps the price it was recorded with; the model's price history is shown.
- **Retire a model:** it stays in the history and reports, marked retired.
- **Delete a model:** only if no usage has ever been recorded against it (a mistake); otherwise retire it.
- Every change needs a note, asks to confirm, and is in the history with who and when.
- **An unknown model:** if a call reports a model that isn't in the list, the usage is still recorded (cost marked "unpriced"), and Ally admins get an alert to add it. Its cost is filled in once the model is added with an effective date covering it.
- **Starting list:** every model the code uses today, with the providers' current prices, shown at the plan stop.
- **Which model each kind of work uses** stays in code and settings for now; this screen shows prices and usage only.

### A2. Metering every AI call

- **ally-ai returns usage** for every model call it makes, from the provider's response: model id, input, cached input and output tokens, embeddings, pages read. Each is tagged with the **kind** (customer reply, crisis check, memory check, summary, setup, site reading, indexing, checkup, judge, change by chat, Try it) and the run id and step.
- **ally-be records `usage_events`:** creator (the user who created the assistant; its plan is theirs), assistant, conversation, channel (bot page, bubble, WhatsApp, owner screens), run id, step, kind, model, units, **cost_micros** (millionths of a dollar), the model price version, created at. **Idempotent** on (run id, step, kind).
- **The metering map** in the plan lists every call path; a test fails if a model call has no usage event.
- Recording never slows or blocks a reply: written after the run; a failure is logged and retried.

### A3. Other paid services

- **WhatsApp fees from Meta:** each conversation Meta charges for (by category: service, utility, marketing, authentication; and the recipient's country) is recorded as kind `whatsapp`, priced from a **WhatsApp rates** table on the Models screen (same add, update and history rules).
- **Anything else paid per use** the plan finds (a scraping service, transcription later) is recorded the same way, with its own kind.
- **Fixed monthly costs** (hosting, database, vector store, subscriptions) are entered by hand per month on the Costs screen.

### A4. Ally admin → Costs (super admins only)

- **Totals** for today, this week and this month, and the trend by day; total including fixed costs.
- **Breakdowns:** by publisher, assistant, kind, model, channel; cost per conversation and per customer message; WhatsApp fees on their own.
- **An assistant's detail:** its cost this month by kind, and its most expensive conversations (linked to the Inbox).
- **Against plans:** with each plan's and seat type's price entered by hand, cost per plan and per seat against what it earns.
- **Alerts to Ally** (email to super admins and a banner here): the day's total over a **daily budget** set here; an assistant costing more than 5× its 7-day average today; one conversation over a threshold set here; an unpriced model.
- **Export** of a period's events as CSV.

---

## Part B — Custom logins and tokens

### B1. A limited role (A2)

- **Custom logins stop being platform admins.** A new limited role, "Assistant owner", holds only what an owner needs: the assistants area, their account, their tokens, plan and seats. Ally admin → Custom logins creates users with it (no more `POST /v1/platform-admins`), with the features ticked as today.
- **Existing custom logins** move to the role by a script with a dry run.
- **Ally-wide WhatsApp routes** (global settings, connectors and numbers with no bot, phone mappings) require a platform admin explicitly.
- **The walk test** from A1 for a custom login must leave **nothing** reachable outside the assistants area and its account.
- **Hide the old WhatsApp number system** (`WA-NUMBERS-REPORT.md` step 1): off the admin screens, no new writes; its readers keep working until they're replaced.

### B2. Token allowance

Ally admin → Custom logins → a user → **Tokens** (super admins only, checked on the server):
- **Assign tokens:** an amount (e.g. 2,000,000), a note, and optionally **renew monthly** (resets to that amount on the same date each month) or an expiry. Adding more tops up the balance.
- **Update** an assignment (amount, renewal or expiry; the balance moves by the difference), **revoke** it (the unused part is removed from now on; used tokens stay used), or **delete** one made by mistake (only while none of it is used; otherwise revoke). Each needs a note and asks to confirm.
- The history of every assign, update, revoke and delete, with who and when.
- **Unlimited** on or off (Ally's team and test accounts).
- Their tokens used this month by assistant and kind, and what that cost Ally in dollars.

**What counts:** input and output tokens of every model call on assistants the user owns, from the A2 usage events. The balance is kept in a row updated in the same transaction as each event (row lock), idempotent on (run id, step, kind), with a nightly check against the events.

**Users who aren't custom logins** are unaffected unless an admin assigns them an allowance.

---

## Part C — Plans and seats

### C1. Data (ally-be)

- **`plans`:** key (`free`, `pro`, `internal`), name, max published assistants, included seats per assistant and their type, monthly customer conversations per assistant, monthly owner-side runs (setup, Try it, checkups, change by chat, re-indexing), price (for the Costs view only), active. Editable by super admins; adding a plan needs no code.
- **`seat_types`:** key (`basic`, `premium`), name, messages per month, rank, price (for the Costs view only). Editable by super admins; adding a 3rd–5th type needs no code.
- **`subscriptions`:** one per **chatbot creator** (plans belong only to the user who creates chatbots; their chatbots count against it, whoever else manages them): plan, status (active, past due, cancelled), current period start and end, set by, note.
- **`seats`:** assistant, seat type, **included or extra**, assigned member (nullable), **start date, billing cycle (monthly), next renewal, status** (active, expiring, lapsed, cancelled), added by, note. Extra seats renew on their own date.
- **`usage_counters`:** per period and subject (a seat; an assistant's customer allowance; a publisher's owner-side runs): count, limit at the time, alerted at 80% and 100%. Incremented with the message, idempotent on (run id, kind).
- **Published** means what the publish gate already records. Drafts are unlimited.

### C2. What counts

- **A seat's messages:** each message an invited person sends on that assistant (signed in on the bot page or bubble, or Try it). A member without a seat can manage the assistant but can't chat with it as a customer would; owners' Try it draws on owner-side runs.
- **The customer allowance:** each new conversation from a public visitor or a WhatsApp number in the month (a person's messages with no 24-hour gap; reuse the conversation record).
- **Owner-side runs:** setup, site reading, checkups, change by chat, re-indexing, per run.

### C3. Screens

- **Ally admin → Plans:** plans and seat types (edit limits and prices, add new ones); renewals due in the next 7 days at the top.
- **Ally admin → Users → a user → Plan** (only for **chatbot creators**: users who have created at least one chatbot, or custom logins with Chatbots on; members, invited people and customers never have a plan): set the plan and period; per assistant, the seats (type, included or extra, assigned to, start, next renewal, status), **Add seats** (type, count, start date), renew or cancel a seat, and this period's counters. Every change needs a note and is in the history.
- **The owner's Plan and usage** (account menu, and each assistant's Share → People):
  - the plan ("Free · 2 of 3 assistants published") and "Ask Ally to upgrade";
  - tokens left, if they have an allowance ("1.2M of 2M tokens left · resets 1 Dec");
  - per assistant: seats ("5 included · 2 extra Premium"), each with its type, who it's assigned to and its renewal; **assign or move a seat** to an invited person; unassigned seats shown;
  - this month: customer conversations ("312 of 1,000"), each seat's messages, owner-side runs, as plain bars with the reset date. **Never dollars.**
- **In context:** Publish shows "This uses 1 of your 3 assistants"; inviting someone offers "Give them a seat" when one is free.

---

## Enforcement (all limits)

Before a run starts, check every limit that applies: the owner's **tokens** (if they have an allowance), the **seat**, the **customer allowance**, the **owner-side runs**. If any is used up, don't start it:
- **public and WhatsApp customers** get the fixed reply: "This assistant isn't available right now. Please contact {business}: {contact from sources}." No AI call;
- **an invited person at their seat's limit:** "You've reached this month's messages. Ask {owner} for a Premium seat." No AI call;
- **owners and their team:** "Your tokens are used up. Ask Ally to add more." or "Your plan's monthly limit for setup and checkups is used up. Ask Ally to upgrade." on setup, Try it, checkups, change by chat and re-indexing;
- **the crisis check always runs and its replies always go out** at every limit, counted but never blocked; nor are the run-failed reply and the limit replies themselves;
- **publishing a 4th assistant on Free** is refused: "Free publishes up to 3 assistants. Ask Ally about Pro." Lowering a plan never unpublishes; new publishing waits until under the limit;
- **a lapsed seat** stops chat for that person (membership stays) until a seat is assigned again; included seats never lapse while the subscription is active;
- a run already started finishes; a token balance may dip below zero by at most one run.

**Alerts:** to the publisher (email and a banner in the home) at 80% and 100% of any limit, once each per period; to Ally admins when an extra seat is 7 days from renewal. The bot page's existing daily cap and rate limits stay.

## Starting point

- **Every existing chatbot creator** gets a subscription: Ally's team and test accounts on `internal` (unlimited); everyone else on the plan Shehbaz sets at the plan stop (suggested: Pro, so nothing is blocked on deploy).
- **Every published assistant** gets its included seats, assigned to its owners first, then editors, until they run out.
- **Existing custom logins** start with the token amount set at the plan stop.
- One migration script with a dry run reports who gets what before writing.

## Tests

- **Models:** add, update (new version, old usage keeps its price), retire, delete (refused once used); an unknown model is recorded as unpriced and alerts; super-admin only.
- **Metering:** every call path in the map produces a usage event with the right kind (a test fails for an unmetered model call); idempotent on retries; a recording failure never affects the reply; a sample of runs matches the provider's usage within 1%; WhatsApp conversations recorded with their category.
- **Costs:** budget and spike alerts fire once; export.
- **Tokens:** assign, top up, update, revoke, delete (refused once used), monthly renewal; concurrent runs keep the balance right.
- **Plans and seats:** a Free publisher can't publish a 4th; each extra seat renews on its own date; a lapsed seat stops chat but keeps membership; a person without a seat can't chat; assigning and moving seats; a new seat type added through the admin screen works with no code change; counters reset on the right day.
- **Enforcement:** at each limit a customer gets the fixed reply with no model call; **a crisis message still gets the crisis reply at every limit**; owner actions are refused with the right message.
- **Access:** models, costs, tokens, plans and seats are super-admin only (server-checked); owners assign seats only on their own assistants; the custom-login walk test.
- Playwright at 1440 and 390: Models, Costs, Plans, a user's Tokens and Plan, the owner's Plan and usage, Share → People, the publish limit.

## Done when

- [ ] Ally admins manage models and prices (add, update with history, retire, delete) and WhatsApp rates
- [ ] Every AI call and WhatsApp conversation is recorded with its cost; Costs shows totals, breakdowns, fixed costs, plan margins and alerts
- [ ] Custom logins are a limited role with a token allowance Ally can assign, update, revoke and delete; the walk test finds nothing reachable outside the assistants area; the WhatsApp number system is hidden
- [ ] Plans (Free, Pro) and seat types (Basic, Premium) as data; Ally assigns plans and seats; extra seats renew on their own dates
- [ ] Every limit pauses politely; crisis replies always go out; no dollars on customer screens
- [ ] `CHUNK-CR1-NOTES.md`, `PR-CR1.md`, the Progress row, `LAUNCH-CHECKLIST.md` (set models and prices, the daily budget, plans, seat types and starting subscriptions and tokens before deploying) <!-- docs-path-lint: planned -->

## Numbers to decide at the plan stop

| Setting | Suggested start |
|---|---|
| Daily cost budget (alert) | $20 |
| One-conversation cost alert | $0.50 |
| Starting tokens for existing custom logins | 2,000,000, renewing monthly |
| Free: published assistants | 3 |
| Pro: published assistants | 20 |
| Included seats per assistant (type) | 5 (Basic) |
| Basic: messages per month per seat | 500 |
| Premium: messages per month per seat | 3,000 |
| Customer conversations per assistant per month | Free 300 · Pro 3,000 |
| Owner-side runs per month | Free 100 · Pro 1,000 |
| Starting plan for current customers | Pro |
| Prices (Costs view only) | Pro per month; Basic and Premium seat per month |
