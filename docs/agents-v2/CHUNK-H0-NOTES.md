# Chunk H0 — notes

> In progress. Report goes at the top when the chunk is done.

## Plan (approved 2026-11-13)

Decisions from Shehbaz at plan time:
- Production does **not** set `AGENT_RUNTIME__CHECKPOINT_DB_URL`, so item 2 (checkpoint retention) is not built.
- The onboarding eval uses a locally signed admin token for user 3 (never printed).
- No `LAUNCH-CHECKLIST.md` line is done in production yet: nothing is ticked, H0's lines are added.

Items:
1. Erasure: one additive migration widens `wa_contacts.phone_e164` to `varchar(64)`; the entity follows; a real-Postgres spec covers erase and the retention sweep.
2. Checkpoint retention: not built (see above).
3. Warm-up: measure the cold first question first; build a 10 s, failure-swallowing warm-up in the lifespan only if the first question is more than ~2 s slower than the second.
4. Live prompt text: `proposeChange`, `writeCheckupQuestions` and `suggestCheckupQuestions` send `getPromptOverrides` for their prompt; a failed store read omits `prompts`.
5. `onboarding_eval.py` reads purpose cards; the health 409s are found and handled as an owner would (owner Must pass only; safety never bypassed).
6. Shared docs last.

Full plan: `~/.claude/plans/session-a-read-docs-agents-v2-context-md-wiggly-flamingo.md`. <!-- docs-path-lint: ignore -->

## Mismatches with the brief

- `BuilderChangeRequest` and `CheckupQuestionsRequest` already have an optional `prompts` (`ally-be/src/ai/dto/`); no type change was needed.
- The brief names a `checkup_failed` 409; the publish codes are `checkup_needed`, `checkup_unsourced`, `safety_recheck` and `must_pass_failed`.
