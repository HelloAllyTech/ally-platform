# Chunk H0 — Hardening before real traffic

> Brief for Claude Code. Read `CONTEXT.md`, `v2-chunks.md`, `LAUNCH-CHECKLIST.md`, `CHUNK-12-NOTES.md` §7, `CHUNK-CL1-NOTES.md` ("Found on the way") and `CHUNK-03C-NOTES.md` §9, then this file. Plan first, as usual.
> Branch: `feat/agents-v2-fast-track` from master. Tag commits `[H0]`. Repos: ally-be, ally-ai.
> **Runs beside 15a,** in another session on the same branch and folder, because the local stack runs one checkout. Commit only your own paths (`git add <path>`, never `-A`). 15a owns the crisis classifier, `chatbot-engine.service.ts` and `src/chatbot/basics/`. Run evals only when the 15a session isn't running its own.
> In your first docs commit, set the root `CLAUDE.md`'s current-chunk line to name both: H0 (`chunk-h0.md`) and 15a (`chunk-15a.md`), in parallel. Edit the shared docs (`LAUNCH-CHECKLIST.md`, `v2-chunks.md`) only in your last commit, after reading `git diff` on them.

## Why

Slice 1 is on master and real traffic is coming: `0fb34139c` moves production onto the v2 agent, and 15a opens public links. Five things that are fine in a demo fail under real use. Owners see nothing new.

## Scope

### 1. Erasure works on real Postgres

- `wa_contacts.phone_e164` is `varchar(32)`. `eraseContact` in `ally-be/src/whatsapp/service/whatsapp-conversation.service.ts` and the orphaned-contacts step of `ally-be/src/whatsapp/service/whatsapp-retention.service.ts` both write `erased:` plus the contact id, 43 characters.
- On real Postgres both throw (`CHUNK-12-NOTES.md` §7):
  - the hourly sweep blanks messages and questions, then stops at the first stale contact, so numbers past retention are never erased;
  - `POST v1/whatsapp/contacts/:id/erase` returns 500 after the messages are already blanked.
- **The fix:** one additive migration widens the column to `varchar(64)`, timestamped after the newest on master (today `1981900947000`). The unique indexes stay. The entity's `length` follows.
- `wa_phone_mappings.phone_e164` is `varchar(32)` too, but nothing writes the marker there. Leave it, and say so in the notes.

### 2. Checkpoint retention, only if production stores runs

- Since `0fb34139c`, the chatbot agent stores runs only when `AGENT_RUNTIME__CHECKPOINT_DB_URL` is set, and no run reads an earlier one.
- **Ask Shehbaz at plan time whether production sets it.**
  - **If not:** build nothing. Record in the notes that G1's "checkpoint DB, retention" line is met by not storing runs, and that retention arrives with the first feature that reads stored runs.
  - **If it does:** a `daily` task in ally-be's scheduler (`scheduledTaskRegistry`, registered the way `whatsapp-scheduler-registration.service.ts` registers the retention sweep) calls a new ally-ai route, `POST /api/v1/agent/checkpoints/prune`. It deletes threads whose newest checkpoint is older than 30 days, in batches, only in the `AGENT_RUNTIME__CHECKPOINT_SCHEMA` schema; Debrief's and the PM agent's stores are untouched. It returns counts, or says it skipped when there's no checkpoint database. ally-ai has no scheduler of its own, so scheduling stays in one place.

### 3. Warm ally-ai before the first visitor

- The first question after a restart once took 19.6 s, near the 20 s run cap (`v2-chunks.md`, Learned so far). 3c baked the tokenizer into the image, and its first question then took 9.6 s; the warm-up 3c named was never built (`CHUNK-03C-NOTES.md` §9).
- **Measure first:** recreate the container and time the first and second searching questions through `/agent/run`. If the first is already within about 2 s of the second, record both and stop here.
- **Otherwise,** warm what's cold in the lifespan in `ally-ai/app/main.py`: build the agent graph, create the embeddings and model clients, and make one embeddings call on a fixed string. No model call unless the numbers show the model client is the cold part.
- **It never holds up or breaks startup:** 10 s at most, failures logged by type only.

### 4. Live text for two prompts

- ally-be never sends the Skills Store text of `ally_ai_builder_change` or `ally_ai_checkup_questions`, so edits to them in Manage Prompts do nothing (`CHUNK-CL1-NOTES.md`). ally-ai already reads `prompts` on both requests.
- Send `getPromptOverrides([...])` with `proposeChange` in `ally-be/src/bot-draft/home/change.service.ts`, and with `writeCheckupQuestions` and `suggestCheckupQuestions` in `ally-be/src/bot-draft/checkup/draft-checkup.service.ts`. The request types gain an optional `prompts`; nothing else changes.

### 5. The onboarding eval passes again

- `ally-ai/scripts/onboarding_eval.py` fails 11 of 13 at baseline: it still reads designs (`REAL_DESIGNS`, and `CLAIMS_BOOKING` over each card's will lines), and three health cases get a 409 on publish.
- **Bring it up to purposes:** the honesty check reads the purpose cards' will and won't lines as they are now.
- **Find why the three health cases get 409** (`checkup_failed` or `must_pass_failed`). Handle it the way an owner would: confirm the owner's own Must pass questions only. A failed safety question stays a fail in the report and is never bypassed.
- It needs an admin `ALLY_TOKEN` and the fixture sites (`fixtures/onboarding-sites/serve.py`). Ask Shehbaz for the token at plan time.

### 6. The launch checklist

- Tick the lines of `LAUNCH-CHECKLIST.md` that Shehbaz confirms are done in production; the code can't see production.
- Add:
  - release `0fb34139c`, then watch the v1 fallback rate and reply times;
  - H0's migration runs with ally-be;
  - if item 2 was built, deploy ally-ai before ally-be.

## Decided

- Widen the column rather than shorten the marker: the full contact id keeps erased rows unique under the existing indexes.
- Retention only where runs are stored.
- No prompt text changes.

## Out of scope

The crisis classifier (15a). Anything an owner sees.

## Tests

- **ally-be:**
  - a real-Postgres spec (`CHATBOT_STORE_TEST_DB`, as the specs in `src/whatsapp/shared-store/test/` use): erasing a contact and the retention sweep both finish, both stores end blanked, and a second run changes nothing;
  - the migration runs, reverts and runs again;
  - each of the three calls sends its prompt's live text;
  - the full suite, lint, typecheck and build.
- **ally-ai:** the warm-up runs once, respects its limit and swallows a failure; the prune route, if built, deletes only stale threads in its own schema and skips when there's no database; pytest and flake8.
- **Evals:** `onboarding_eval.py` 13 of 13; the Sunrise checkup suite and the 3a conversation eval unchanged (0 hard fails).

## Report (`CHUNK-H0-NOTES.md`)

What changed per item and why; the cold-start numbers before and after; the retention decision and production's setting; the checklist lines ticked and added; suites and evals.

## Done when

- [ ] Erasing a contact and the retention sweep both finish on real Postgres
- [ ] Checkpoint retention built, or recorded as not needed with production's setting
- [ ] A freshly started ally-ai answers its first searching question within about 2 s of a warm one
- [ ] Live edits to `ally_ai_builder_change` and `ally_ai_checkup_questions` take effect
- [ ] `onboarding_eval.py` passes 13 of 13
- [ ] `LAUNCH-CHECKLIST.md` ticked and extended; `CHUNK-H0-NOTES.md` written; H0's row in `v2-chunks.md`'s Progress table

## How Shehbaz tests it

1. **Erasure:** run the Postgres spec. Then `POST /api/v1/whatsapp/contacts/:id/erase` on a local WhatsApp contact returns 200, and the contact's `phone_e164` starts with `erased:`.
2. **Cold start:** in ally-ai, `docker compose -f docker-compose.local.yml up -d --force-recreate --no-deps app`, then ask any assistant a question in Try it. The first reply comes about as fast as the second, from the agent.
3. **Prompts:** in Manage Prompts, add a line to `ally_ai_builder_change` (for example "End your reply with: Done."), then ask Change your assistant for something: the reply follows it. Remove the line.
4. **Onboarding eval:** `python3 fixtures/onboarding-sites/serve.py`, then in ally-ai `poetry run python scripts/onboarding_eval.py` with `ALLY_TOKEN` set: 13 of 13.
