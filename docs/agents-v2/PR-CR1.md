# CR1 — Costs, models, tokens, plans and seats

Block 2 of `FINAL-PLAN.md`; brief `chunk-cr1.md`; notes `CHUNK-CR1-NOTES.md`.

## What it does

**Part A: costs and models.** Every AI call an assistant makes, and every message Meta bills for on WhatsApp, is now recorded with what it cost Ally, from a priced model list Ally admins manage.
- ally-be tags each call to ally-ai with an `X-Ally-Usage` header (run, assistant, chat, kind). ally-ai copies it onto the usage it already sends over SQS. ally-be prices that into `usage_events`, idempotent on (run, kind, step, call).
- Embeddings are now metered too.
- Recording never touches a reply: the send runs on a background thread, the record is written after the run, and a failure retries from SQS.
- **Ally admin → Models:** prices per million tokens or per unit, versioned from a date (old usage keeps its price), retire, delete only if unused, unpriced-model alerts, WhatsApp rates.
- **Ally admin → Costs:** totals, trend, breakdowns, per conversation and per message, fixed costs, plan margins, CSV.
- Budget, spike (5× and over $1), conversation and unpriced alerts fire once a day by email and Slack. A production deploy with no usage feed alerts loudly.

**Part B: custom logins and tokens.** Custom logins are no longer platform admins.
- They become a new **Assistant owner** role: the assistants permissions only, scoped to their own organisation.
- A walk test runs every controller as one, and nothing that needs a permission or toggle is reachable outside assistants and their own account.
- The Ally-wide WhatsApp routes now need a platform admin.
- The old WhatsApp numbers are hidden and take no new writes.
- **Token allowances:** assign (tops up), update, revoke, delete (only while unused), monthly renewal, unlimited, with a history. They're counted under a row lock in the same transaction as each usage event.

**Part C: plans and seats.**
- Free (3 published), Pro (20) and internal plans; Basic (500 messages a month) and Premium (3,000) seats. All are data that super admins edit.
- Plans belong to chatbot creators only.
- Each published assistant gets 5 included seats. Extra seats renew on their own date. Seats are strict.
- Monthly limits: customer conversations per assistant, and the creator's owner-side runs.
- **At any limit no run starts.** The person gets a fixed, honest reply in their language with no AI call, and **the crisis check still runs, so a crisis reply always goes out** (tested at all five limits).
- Owners see **Plan and usage** (account menu) and seats in Share → People, with counts only and **never dollars**.

## Decisions (CR1 plan stop, 19 Nov)

- Starting tokens are max(20M, 3× the last 30 days).
- Seats are strict, and the backfill dry run lists everyone who'd be blocked.
- Try it never uses a seat.
- Seats, conversations and owner runs are counted synchronously before the run; tokens are counted from SQS.
- A spike also needs the day's cost over $1.
- The crisis model default needs a follow-up before 14 Jan 2027.
- A loud alert fires when the usage feed is off.

The other numbers are as suggested; prices are left blank.

## Mismatches with the brief

- **WhatsApp billing:** Meta bills per delivered message, not per conversation.
- **Price list:** prices live in a new `billing_models` list, because `llm_models` is the runtime pickers' list.
- **Usage feed:** ally-ai already sent usage over SQS, so CR1 extends that path.
- **How it works:** it makes model calls, so it is metered as its own kind (`instructions`).

## Deploy

See **`LAUNCH-CHECKLIST.md` → CR1**:
- Set `LLM_USAGE__QUEUE_URL`.
- Deploy ally-ai first.
- Three additive migrations run with ally-be.
- Check prices and set the budget and plan prices.
- Run `custom-logins:migrate` and then `billing:backfill`, each with a dry run first.
- No prompt changes.

## Screenshots (1440 and 390)

`docs/agents-v2/screenshots/cr1/`: `models`, `costs`, `plans`, `user-tokens`, `user-plan`, `my-plan`, `share-people`, `publish-limit`.

## Tests

- **ally-be:** the full suite passes (18,629 tests). Three route-walk guards and the builder registry were updated for the new routes.
- **Postgres specs (211 tests):**
  - recording, idempotency, price versions, repricing, WhatsApp fees, alerts once a day;
  - tokens, including 25 concurrent runs;
  - publish limit, seats strict / lapse / assign / move, a new seat type with no code, counters once per run, the 24-hour gap, periods, internal.
- **Engine:** at each limit, a fixed reply with no agent call, and a crisis reply for classifier and keyword crises.
- **Walk test** for the Assistant owner role.
- **ally-ai:** 3,133 tests pass, flake8 clean. A metering-map test plus an AST check keep every provider call going through the metered dispatcher.
- **ally-web (Node 22):** 692 + 321 + 48 test files pass. The Playwright billing specs pass (14). A test checks the owner screens never show "$".
- **Not run:** the Docker Playwright baselines. `home-share.png` needs regenerating, because Share now has Seats.

## How to test

1. **Costs:** chat on a bot page, use Try it and run a checkup. Ally admin → Costs shows them by assistant, kind and model.
2. **Models:** change a price from a date. Old usage keeps its cost; delete is refused once a model has been used.
3. **Custom logins:**
   - Run `npm run custom-logins:migrate -- --dry-run`, then run it for real.
   - Log in as a custom login: only Assistants is there.
   - Assign 1,000 tokens and chat past them. A crisis message gets the crisis reply; a normal one gets "isn't available".
4. **Plans:**
   - Run `npm run billing:backfill -- --dry-run`.
   - On Free with 3 published, try to publish a 4th.
   - Invite someone with no seat and chat as them, then give them a seat in Share → People.
5. **Owner view:** account menu → Plan and usage shows no dollars.

## Follow-ups

- Point the Analytics cost charts at `billing_models`.
- Change the crisis and translate code defaults before 14 Jan 2027.
- Meter the remaining embedding calls (Context Library, roadmap, reference documents).
- Let admins assign seats on the admin Plan screen.
- Return structured banner alerts.
- Add a list of existing users that can become custom logins.
