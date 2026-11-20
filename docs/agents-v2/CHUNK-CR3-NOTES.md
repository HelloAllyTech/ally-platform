# CR3 notes: the spend cap replaces token allowances

Brief: `chunk-cr3.md`. Branch `feat/cr-spend-cap`. Launch steps: `LAUNCH-CHECKLIST.md` → "CR3".

## What changed for people

- **Owners:** no Tokens card on Plan and usage, and no tokens anywhere else. Seats read "Basic · 500 messages a month". If Ally's cap is reached: an email, "Monthly usage: used up" in the alerts, and "Your account has reached this month's usage limit. Ask Ally to raise it." on Try it, setup, checkups and change by chat.
- **Customers and invited people:** unchanged. At the cap they get the same "This assistant isn't available right now" reply as before; crisis replies still go out.
- **Ally (super admins):** Plans has "Cost cap per creator per month ($)". A user's page has **Spend** in place of Tokens: this period's cost against the cap, the cap's source, their own cap, "Never capped", cost by assistant and by kind of work, and the history. A user's Plan shows the same spend line. Alerts at 80% and 100% arrive like every cost alert (email, Slack, the Costs banner).

## Code map

**ally-be** (`src/billing/`)

- `service/spend-cap.service.ts` (new): a `UsageEventListener`. Each priced usage event is added to the creator's `spend_periods` row for the plan period the call happened in, inside the event's own transaction. `isOverCap`, `state`, `summary`, `setCap`, the nightly `reconcile`, and the 80% / 100% notices. `capOf(plan, subscription)` is the one place that decides which cap applies.
- `service/limits.service.ts`: `checkTurn` and `assertOwnerRun` ask `spend.isOverCap` where they asked `tokens.isUsedUp`. The verdict `owner_tokens` is now `owner_cap`; the API error code `TOKENS_USED_UP` is now `USAGE_CAP_REACHED`. Order of checks, failing open and the crisis check are as before.
- `service/plan-view.service.ts`: `forUser` no longer returns `tokens`; it returns `capReached` and, when true, a "Monthly usage" alert at 100. `forAdmin` adds `spend` in dollars.
- `service/plan.service.ts`: `savePlan` takes `costCapUsd`; the catalogue returns `costCap`.
- `service/cost-report.service.ts`: plan margins now count creators with no subscription under Free (their cost was left out before).
- `controller/billing-users.controller.ts`: `GET v1/admin/billing/users/:id/spend`, `PUT …/spend/cap`. The token endpoints are gone.
- `entity/spend-period.entity.ts` (new); `plan.entity.ts` and `subscription.entity.ts` gain the cap columns.
- Removed: the token service, its Postgres spec, the token DTOs, and the token step of `billing:backfill`. The `TokenGrant` and `TokenBalance` entities stay, because their tables do.
- Migration `1985400000300-AddSpendCap`.
- `chatbot/engine/limit-reply.ts` and `chatbot-engine.types.ts`: the renamed reason and its text in English, Hindi and Hinglish.

**ally-web** (`apps/ally-admin-dashboard/src/`)

- `pages/Plan/`: `MyPlan.tsx` (no Tokens card), `ui.tsx` (seat allowance in words), `copy.ts`, `limits.ts` (accepts `USAGE_CAP_REACHED`, and `TOKENS_USED_UP` for one release).
- `pages/Billing/Users/UserSpend.tsx` replaces `UserTokens.tsx`; `UserPlan.tsx` shows spend against the cap.
- `pages/Billing/Plans/`: the cost cap column and form field.
- `api/plans.ts`, `constants/common.ts`: `getUserSpend`, `setUserSpendCap`.
- `components/sidebar/PlanMenuItem.tsx`, `components/assistant-only/AssistantOnlyHeader.tsx`: Plan and usage is offered to creators only.

## Decisions

1. **Dollars, not tokens.** Tokens ignored model prices and WhatsApp fees. The cap counts `usage_events.costMicros`, so it is the same number the Costs screen shows.
2. **The cap belongs to the plan,** with a per-creator override on `subscriptions` (`costCapMicros`, `costCapOff`). Nobody has to remember to assign one per user. Setting a creator's own cap creates a subscription on the plan they are already on, anchored where their counters already reset, so nothing else about their plan moves.
3. **Period = the plan period,** the same one customer conversations and setup runs reset on. An event is counted in the period it happened in, not the one it was recorded in.
4. **Unpriced usage adds nothing** until it is priced; the nightly reconcile then sets the period to what its events add up to. The unpriced-model alert already covers the gap.
5. **The owner hears only at 100%,** and never an amount. An 80% warning would be a ninth number on their screen for something they cannot act on.
6. **A changed own cap clears the period's alert marks,** so Ally hears again if the new cap is reached. Changing the plan's cap does not; the next event past the line still stops runs, it just does not re-alert in the same period.
7. **"Unlimited tokens" became "Never capped".** The migration carries it over.
8. **Tables kept.** `token_grants` and `token_balances` are left in place and unread.

## Behaviour worth knowing

- The total moves with the SQS delay (seconds), like every cost number. A run already started finishes, so a period can end a little over its cap.
- Limits still fail open: a database error in the cap check lets the message through.
- A cap of $0 is refused; empty means no cap.
- `token_drift` alerts are no longer raised. The kind stays in the enum and CHECK for old rows.

## How to test

- **ally-be:** `npm test -- --forceExit --detectOpenHandles`, `npm run lint`, `npm run typecheck`. `npm run build` needs `NODE_OPTIONS=--max-old-space-size=8192` on a laptop.
  - Postgres specs: make a scratch copy with the migration applied, then `CHATBOT_STORE_TEST_DB=postgres://postgres:<DB_PASSWORD>@localhost:5477/ally_spendcap_test npx jest src/billing`. `spend-cap.pg.spec.ts` covers counting once, the plan's cap, a creator's own, never capped, the 80% and 100% notices, periods and the reconcile; `plans.pg.spec.ts` covers the cap at the limit checks.
  - Engine: `npx jest src/chatbot/engine/test/chatbot-engine-limits.spec.ts`.
- **ally-web (Node 22):** `npx nx test ally-admin-dashboard`. Browser tests against a static build, so no second dev server takes over :8081: `npx vite build`, `npx vite preview --port 8095 --strictPort`, then `E2E_BASE_URL=http://localhost:8095 npx playwright test -c playwright.config.ts e2e/billing.e2e.ts -g "Plans: renewals|Spend and Plan|Plan and usage"`. The Share → People test needs the dev-only pages, so it needs a dev server.
- **By hand:** set Pro's cap to $0.01, send one message, and the next customer message gets the "isn't available" reply while a crisis message still gets its reply; Costs shows the alert; raise the cap and the assistant answers again.

## Open questions

1. **The cap amounts for Free and Pro.** Not set here. Until they are entered nobody is capped.
2. Context Library: the MCP was not connected in this session, so the new owner wording follows the existing limit messages, uncited. Worth a search from an `ally-be` session before release.
3. One reset date for everything an owner sees (seats reset on their own start day).
4. Drop `token_grants` and `token_balances` once nobody needs the old numbers.
5. Screenshots `share-people` and `publish-limit` in `screenshots/cr1/` were not re-taken (they need the dev-only pages); seats there now read "Basic · 500 messages a month".
