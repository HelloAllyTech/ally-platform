# Q4 light: notes

> In progress on `fix/agents-v2-q4`. The code map, decisions and results are filled in as each section lands; the before/after is at the end.

## For RC1: Postgres specs that fail on master too

Run with `CHATBOT_STORE_TEST_DB` on `ally_t1_test`. Each also fails on a clean checkout of `master` (checked 23 Nov), so Q4 leaves them alone:

| Spec | Test | What fails |
|---|---|---|
| `ally-be/src/chatbot/inbox/test/inbox.pg.spec.ts` | lists Safety first, then Needs a person, then the newest; unread until opened | `TypeError: Cannot read properties of null (reading 'length')` at `inbox.service.ts` `list()`: `this.scope()` returns null in the test's context |
| `ally-be/src/chatbot/inbox/test/inbox.pg.spec.ts` | marks website chats, and filters Website apart from Bot page (chunk 13) | the same |
| `ally-be/src/bot-draft/test/bot-draft.pg.spec.ts` | publishing twice converges one live chatbot, one page and one access list | expects `safety_pack_version: 1`; publishing stores the pack's current version (Mental health is 2 since SP1) |

## Local setup used for the measurements

- User 25 on `ally_local` is on the Internal plan (it had 21 live assistants, over the Free plan's 3 publishes).
- A local 12-hour owner token, signed for the use-case suite's setup.
- The suite signs in to an invite-only page once per invited address and starts a new chat for each conversation: the page limits sign-in codes per address, which refused O4's last conversations in the first measurement (a test artefact, not a product bug).
- A flaky ally-ai metering test passed on retry.
