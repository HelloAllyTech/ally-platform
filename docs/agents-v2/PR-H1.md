# H1: replies that finish, bookings that are safe

Hotfix before CR1 merges and before master is deployed. Brief: `docs/agents-v2/chunk-h1.md`. Investigation: `docs/agents-v2/H1-PART-A.md`. Notes: `docs/agents-v2/CHUNK-H1-NOTES.md`.

## Why

On 19 Nov, 10 of 18 production replies hit a ~20 s cutoff and got the "Sorry, I couldn't answer that just now" fallback. Locally, a booking turn moved a customer's existing appointment without a "yes" and replied only "Done: Sat 21 Nov 2026, 13:00 in Appointments." Part A found:
- the cutoff is ally-ai's `RUN_TIMEOUT_SECONDS = 20`. After a write, ally-be's 22 s stream deadline fires first instead, and that is where the bare "Done" lines come from;
- every turn ran 2–4 model calls in a row, and nothing streamed until the run ended;
- the crisis classifier timed out on 30 of 63 turns, which missed the "bleach in my eye" emergency and held finished replies back by up to 12 s;
- `update_*` had no consent check at all, and "OK" counted as a yes.

## What changes

**Bookings (Part B)**
- Every `create_*` and `update_*` is checked in ally-be's gateway:
  - it is dry-run first;
  - it is written only after a plain "yes", in a later turn, to an assistant message that named exactly that entry;
  - otherwise the gateway answers with a fixed question ("Shall I book Eye checkup on Sun 22 Nov 2026, 11:00 for Priya Test?"), and the run ends on it;
  - moves and cancels name the entry they change.
- A run ally-be has stopped waiting for can't write any more. A write already in flight is reported from the saved record, never as a bare "Done".
- The run token expires with the run's cap. ally-be names the cap (45 s streamed, 38 s WhatsApp) and always waits 5 s longer.
- No OpenAI SDK retries inside a run.

**Speed (Part C)**
- The reply streams as the model writes it.
- A status line appears the moment a message arrives.
- A search runs before the first model call, so a plain answer takes one model call.
- A stream that sends no progress for 25 s ends; the hard cap is 45 s.
- Reasoning effort defaults to "low".
- Crisis check:
  - one 4 s attempt and one quick retry, all inside 6 s;
  - if it still fails, emergency keyword rules decide (a chemical, burn or injury to the eye; sudden vision loss; in English, Hindi and Hinglish).

**Quick fixes (Part D)**
- No citation leftovers in replies.
- Approved warm and polite-decline replies for upset and medicine-advice messages.
- No repeated helpline number in the at-risk reply.
- The old "Something went wrong" fallback is migrated.
- The publish prompt and the Checkup show one number.
- Purpose cards and the builder line no longer say the assistant can't book.
- The Lists view refreshes on its own.

Also: one `[AGENT STAGE]` log line per stage of a turn, in both services, under one run id. There is also a dev-only slow tool for tests, which production ignores.

## Results (local, same test before and after)

| | Before | After |
|---|---|---|
| Fallbacks (63 messages) | 4 | 0 |
| Reply done, median / worst | 15.1 / 22.1 s | 8.4 / 29.2 s |
| Status line on screen | up to 5 s | 0.05 s |
| First reply words, median | 15.1 s | 7.4 s |
| Crisis check failures | 30 of 63 | 0 of 84 |
| E-S1 emergency reply | 1 of 3 | 3 of 3, 1.7–2.0 s |
| Writes without a prior-turn yes | 7 | 0 of 18 |
| Existing bookings changed without a yes | 1 | 0 |

Not met yet:
- **Worst reply under 20 s:** 7 of 63 turns were over. These are upset and medicine replies that get rewritten, two booking turns, and one second search.
- **First words under 3 s:** the model reasons 2.7–10 s before its first token. Production was not measured; measure it after deploy (`LAUNCH-CHECKLIST.md`).

## Before deploying

- Publish `ally_ai_builder_system` (approved line 7) to production's Skills Store.
- Check prod's `AGENT_RUNTIME__*` env and the agent and crisis prompts' models.
- Migration `1984850000000-CurrentRunFailedReply` runs with ally-be.
- Redis is needed for bookings: if it's down, nothing is written.

## Tests

- ally-be: the full suite (the hooks ran 5,772 tests).
- The gateway's Postgres specs: 17 consent cases, run locally against a scratch database (CI skips them).
- ally-ai: 3,119 tests; flake8 clean.
- ally-web: 1,534 tests in the affected apps, on Node 22.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
