# Debrief family: what each agent is measured on

Every agent in the Debrief family has the numbers the PRD and plan v9 asked for, plus the numbers the
evals skill (`~/projects/Ally/.claude/skills/evals`) and the article it follows require. "Right" is
defined **once, in code**, and the paired eval, stored results and the Console's live metrics all
use that one definition: `ally-be/src/debrief/util/debrief-outcome.util.ts` (whole debrief, Ask
Ally, PM agent) and `ally-be/src/debrief/util/debrief-stage-metrics.util.ts` (each agent inside a
run).

## Rules every number follows

From the excerpt the user shared and the evals skill:

- **One number per agent, and it fits the kind of output.** For replies it's the pass rate, the share
  of replies with no failure (Debrief, Ask Ally). For an agent that acts, it's the share of tasks
  that end in the right database state, plus a clean path (PM agent). For a stage inside a run, it's
  the stage's own failure, so a bad debrief can be traced to the step that caused it.
- **Every rate carries n and a 95% interval** (Wilson). Every version comparison is paired on the same
  cases and reports how many cases got better and how many got worse, the paired interval, and the
  exact McNemar p.
- **A missing score is not a low score.** A run not judged yet, or skipped by design (too short,
  organisation off), has no verdict and is left out. It's never counted as a failure. An outage (a
  model that couldn't be reached) is counted, but shown apart from quality failures.
- **Segment before reading a trend:** language × writing model × judge version. Never read one trend
  line across two judge versions.
- **Decisions come from the test set, live data is for monitoring.** Numbers that need an answer known
  in advance (planted risk cues, planted faults, planted ideas, gold guidance lists) exist only
  offline. Live data gets the same graders, minus the gold.
- **Graders get checked too:** planted-fault catch rate (the gate), flip rate when re-judging, and
  later agreement with a judge from another model family (κ, plus recall on the reference's flagged
  cases). No hand-labelled sets (team decision).

Where each number is read: **Console** = Debriefs → Metrics (live, from production runs). **Eval** =
`ally-be/scripts/debrief-eval.js` on the prod test sets (open = dev, gate = test, sealed = never
tuned on). **Gate** = a script that exits 1 on a miss.

## The whole debrief

| | Number | Where | Status |
|---|---|---|---|
| PRD (kept) | Steering score (judge, practise-next click-through, thumbs); guardrails: judge median, hard-fail rate, fabricated quotes, thumbs-down, time to a debrief, cost, internal check minus judge; efficiency; learner experience; uptake lift | Console | Live |
| Evals skill | **Pass rate:** reached the learner (published or below the bar), no blocking check failure, no judge hard fail | Console (per week, per language, per language × writing model × judge version) and Eval | Live; Eval run 2026-11-11 |
| Evals skill | Outages counted apart; not-scored counted apart | Console, Eval | Live |
| Evals skill | Paired difference against GA, cases better and worse, McNemar p | Eval | Built |
| Evals skill | pass^3 on a 20-case reliability slice; cost per passing debrief; time p50/p90 | Eval | **To build** |

## Safety reader

| | Number | Where | Status |
|---|---|---|---|
| Plan (kept) | Recall on the seeded safety set: every planted cue found on every repeat (100% × 3); false alarms counted, not gated | Gate `debrief_safety_recall.py` (now takes `--model` to gate a backup or swap) | Built: 18/18 × 3 on `gemini-2.5-flash` and on the backup `gemini-3-flash-preview` |
| Evals skill | Gave no reading (both attempts failed), needed a second attempt, time p50/p90 | Console | Live |
| Evals skill | Sessions with a risk cue (a drift signal, not a grade) | Console | Live |
| Evals skill | Judge found a missed risk cue although every cue the reader found was covered (a cue it didn't find, or covered without substance) | Console | Live |
| Evals skill | Recall in all five languages at the plan's ≥ 60 cases | Gate | **To grow** (18 cues today) |

## Analyst

| | Number | Where | Status |
|---|---|---|---|
| Evals skill | Gave no evidence map; time p50/p90 | Console | Live |
| Evals skill | Its risk and distress flags against the safety reader and the judge (κ, recall); flip rate over 3 re-runs | Eval | **To build** |

## Progress reader

| | Number | Where | Status |
|---|---|---|---|
| Evals skill | Gave no reading | Console | Live |
| Evals skill | Judged debriefs that used a progress reading and still claimed progress without support | Console | Live |
| Plan case 20 | Planted noisy histories: "too early to tell" | Eval | **To build** |

## Guidance lookup (the finder)

| | Number | Where | Status |
|---|---|---|---|
| Evals skill | Found guidance; entries per debrief | Console | Live |
| Evals skill | Risk entries given to a session with no risk cue; a level guide written for another learner level | Console and Eval | Live |
| Evals skill | hit@k and recall@k against a gold entry list per case (the gold list comes from a judge of another model family) | Eval | **Needs OpenRouter** |
| Plan case 17 | A planted protocol is retrieved and named | Eval (DG-0018 pattern: an organisation with no live debriefs, archived afterwards) | Run by hand once: retrieved 2/3, named 1/3; repeatable case **to build** |

## Writer

| | Number | Where | Status |
|---|---|---|---|
| Evals skill | First drafts that passed every blocking check; the most common first-draft failures; gave no draft | Console | Live |
| Evals skill | Whole-debrief pass rate is mostly its work: read it with the Reviser's numbers | Console, Eval | Live |

## Reviser

| | Number | Where | Status |
|---|---|---|---|
| PRD (kept) | Revision rounds, median | Console | Live |
| Evals skill | Fixed a first draft that failed a check | Console | Live |
| Evals skill | Revisions that broke a check the draft before passed | Console | Live |
| Evals skill | Ran out of time for another revision | Console | Live |

## Evaluator (inside the run; decides publish or hold)

| | Number | Where | Status |
|---|---|---|---|
| PRD (kept) | Internal check minus judge (score gap) | Console | Live |
| Evals skill | Agreement with the independent judge on missed risk cues: κ, recall on the judge's flagged cases, false-flag rate | Console | Live. 2026-11-11, 116 risk runs: κ 0.10 (barely better than chance) |
| Evals skill | Debriefs it held for a person on its own (judge and checks passed them) | Console | Live |
| Evals skill | Planted-fault gate like the judge's | Gate | **To build: the biggest gap** (its instructions are pinned; changing them needs a person) |

## Independent judge

| | Number | Where | Status |
|---|---|---|---|
| Plan (kept) | Planted-fault gate: fake quote, deleted risk moment, swapped debrief, padding, injection, diagnosis, wrong language, and now protocol contradiction plus its look-alike | Gate `debrief_quality_perturbations.py` | Built: 10/10 on the prod judge |
| Evals skill | Flip rate when re-judging the same debriefs | Eval (`--rejudge`) | Built: 0 flips in 20 (dev, 2026-11-11) |
| Evals skill | Debriefs that reached the learner and were scored; judge versions in the window | Console | Live |
| Evals skill | Agreement with a judge from another model family (today Gemini judges Gemini) | Eval | **Needs OpenRouter** |
| Note | The run judge now sees the guidance the Writer saw (version `+g1`), so a protocol contradiction can be caught | — | Built, not released |

## Ask Ally (replies to learners about their debrief)

| | Number | Where | Status |
|---|---|---|---|
| PRD (kept) | Learners who replied (experience); ≤ $0.05 per reply | Console (replied); cost **to wire** | Live (replied) |
| Excerpt | **Pass rate, the share of replies with no failure:** no code check failed (a reply that fails is replaced by the fallback) and the judge finds no unsupported claim, no contradiction of the debrief, no unsafe advice | Console | Checks live; **pass rate needs the Ask Ally judge** (no verdict until then) |
| Evals skill | Replies that passed the checks; learner distress flagged | Console | Live. Prod read 2026-11-11: 7 of 27 replies on live debriefs were replaced by the fallback |
| Evals skill | Test set of real follow-up questions, graders, paired runner | Eval | **To build** (Part B) |

## PM agent (proposes and tests improvements)

| | Number | Where | Status |
|---|---|---|---|
| Plan (kept) | Ideas through the ladder: screen → gate → trial → canary; learning budget spent | Console (PM agent tab) | Live |
| Excerpt | **Share of tasks that end in the right database state, plus a clean path.** Offline: on planted good, bad and neutral ideas, the decision matches the known right one, within budget and with no forbidden action | Eval | Definition built; planted good/bad/neutral fixtures in `ally-ai/tests/fixtures/pm_agent_planted_ideas.json` (with the expected decision, forbidden actions and spend limit); **runner to build**. The clean path is read from `agent_lesson_audit` (`blocked` rows with `detail.neverList` for the run's `agentRunId`) |
| Evals skill | Live: promotions that still stood 14 days later without a revert (the plan's late-revert read); ideas screened, gate-tested, promoted, reverted, rejected, waiting | Console | Live |
| Evals skill | pass^3 and cost per correct decision | Eval | **To build** |

## Not decided yet

- **Where eval runs are stored** (user's decision). A ready implementation on `agent_eval_runs` /
  `agent_eval_results` is parked as a patch outside the repo.
- Test-set sizes, once a full eval pass has been costed (user's decision), and whether the evals run
  once, after OpenRouter.
