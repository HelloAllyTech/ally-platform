# CR3: the spend cap replaces token allowances

A change request to CR1 (`chunk-cr1.md`), not part of a numbered chunk. Branch: `feat/cr-spend-cap`. Notes: `CHUNK-CR3-NOTES.md`.

## Why

CR1 shipped two unrelated limits on the same assistants:

- **The plan** (Part C): assistants published, customer conversations per assistant, seats with messages per month, setup and checkup runs.
- **Token allowances** (Part B): typed in by hand per user, with no link to the plan.

They collided. A seat worth 500 messages a month could sit on a 1,000-token allowance that one reply used up. When tokens ran out, customers got the same "isn't available" reply as when conversations ran out, and the owner got no email or alert. Owners were shown a number, "1,000 of 1,000 tokens left", that meant nothing to them.

Tokens were also not how Ally knows its spend: every model call is already in `usage_events` with its dollar cost, creator and assistant.

## Decisions

1. **Tokens stop being a limit.** Nothing reads `token_grants` or `token_balances`. Owners no longer see tokens anywhere.
2. **Each plan carries a monthly cost cap per creator, in dollars.** Set by super admins on Ally admin → Plans. A creator can have their own cap, or be never capped (Ally's team and test accounts).
3. **Owners never see the amount.** If the cap is reached they are emailed and see "Monthly usage: used up"; customers get the existing "isn't available" reply; crisis replies still go out.
4. **Ally hears first.** An alert at 80% of a cap and again at 100%, so the cap can be raised before anyone is cut off.
5. **Seats stay exactly as they are.** The owner screens now say what a seat gives in words: "Basic · 500 messages a month".

## Not in this change

- The cap amounts for Free and Pro. They are entered on the Plans screen after deploy; until then nobody is capped.
- Dropping the two token tables.
- One reset date for everything: seats still reset on their own start day.
