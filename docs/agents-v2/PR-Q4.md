# Q4 light, part 1: safe publishing, hand-over, crisis and emergencies, bookings, search

Brief: `docs/agents-v2/chunk-q4.md`. Notes, decisions, the status of every item and the misses left for Phase 3: `docs/agents-v2/CHUNK-Q4-NOTES.md`. Prompt and fixed texts: `docs/agents-v2/Q4-PROMPTS.md`. Part 2 (the typed booking path, the demo build's H5–H12, speed, E, F, the demo sets and the final 3-run comparison) follows in its own PR.

## Why

The 20–23 Nov rounds and the production demo build found publishing blocked with no message, hand-over replacing answers, unverified crisis numbers, emergencies missed on non-health assistants, an at-risk message mid-conversation answered normally, wrong safety packs, booking and consent errors, and in-data answers right only 57% of the time. Q4 built a use-case suite first (`evals/usecases/`: 13 assistants, about 300 conversations through the live page) and fixed against it.

## What changes

**Safety and publishing**
- Publishing's safety recheck runs in the background; the Share step shows its progress, then the question that still fails, its answer, why, and how to fix it (Open the Checkup, "This isn't right for my business", Check again). Setup's Checkup rows open to show why a question needs a fix; safety questions are tagged.
- Life-threatening emergencies (collapsed, not breathing, choking, heavy bleeding, chest pain, seizure, overdose, stroke signs, severe burn, fire, someone attacked) on every assistant, deciding at once.
- The crisis check judges the latest message with its history and on its own; indirect hopelessness is at risk on mental-health assistants; an upset reply always carries 14416 and 112.
- Crisis numbers only from the owner's confirmed Safety settings; "I don't have crisis numbers" is never sent.
- The pack: health industries keep their own; the owner corrects it in setup with a reason; a staff assistant gets the pack for its readers. A diagnosis request gets a caring decline (wording for review, E1).

**Hand-over:** it never replaces an answer (14 replaced at the baseline, 0 now); its lines in Hindi and Hinglish.

**Bookings and lists:** one confirmation question naming the day, time, place and places, with a verb for the list (register, callback, application, book); exactly one confirmation before every save (8 of 8); Try it holds a test slot and says "Test only, not saved"; refusals with the nearest free times; details from before the chat reused; booking for someone else; checkups as a test person; placeholder names ("unchanged") never saved and repaired.

**Answers and search:** key facts (up to 10) in every run; a non-English message searched in English as well as as written (the as-written pre-search found nothing in other scripts); neighbour chunks and hybrid keyword search; struck-out prices labelled; stray citation text removed; answer each of a few options instead of "which one?".

**Grader:** reads every passage a run retrieved, with its neighbours; hand-ruling fixes to the sets.

## Results (like for like, 11 assistants, 1 run each)

Both runs graded by the same grader, so the gain is the product's, not the grader's (the baseline's replies were re-graded with their passages rebuilt from the retrieval log):

| | Baseline | Now |
|---|---|---|
| In-data right, same grader, the sets as at the baseline | 55% | 74% |
| In-data right, same grader, with the hand-ruling set fixes | 60% | 75% |
| Not English, in-data right | 34% | 66% |
| Answers a hand-over replaced | 14 | 0 |
| Asked back instead of answering | 18 | 12 |
| Saves with exactly 1 confirmation | 4 of 6 | 8 of 8 |
| Emergencies right | 26/26 | 25/26 (the miss is now caught by keywords) |

85% isn't reached; the 28 misses left are in CHUNK-Q4-NOTES "For Phase 3".

## How to test

- `cd ally-be && npm test -- --forceExit --detectOpenHandles`, lint, typecheck; Postgres specs with `CHATBOT_STORE_TEST_DB` (3 failures that also fail on master, listed in the notes).
- `cd ally-ai && poetry run pytest tests/ && poetry run flake8`.
- `cd ally-web && npm test && npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json` (Node 22).
- The suite: `node evals/usecases/run.mjs --label <label> --setup 2026-11-22`, then `compare.mjs` and `confirmations.mjs`.

## Before deploying

`LAUNCH-CHECKLIST.md` "Q4 light": four migrations; publish the approved prompts (judge, hand-over, upset, phone rule, classify, booking, system); confirm each live assistant's crisis line in Safety.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
