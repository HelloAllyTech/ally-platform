# Chunk 07 notes: long-term memory and feedback

Status: **closed 2026-11-14.** Built and tested offline and on Postgres. The paid
mechanics check ran (run 43555980695, $1.60) and found two recall defects, listed
below as the first follow-up. They are not fixed yet.

## Decisions (user, 2026-11-14)

- **Feedback = verdicts** while there are no PRs (`output_mode: suggested_fix`). A
  verdict has two parts plus a reason: `diagnosis: correct | wrong | not_a_bug` and
  `fix: worked | needed_edits | wrong | none`. It is written with
  `bug-hunter verdict <run_id> --diagnosis … --fix … --reason "…"` into
  `bughunter.verdicts` (migration `0002_verdicts.sql`). The chunk 09 dashboard writes
  the same table.
- **Mapping to memory:**
  - `not_a_bug` goes to `false_alarms`;
  - `wrong` goes to `wrong_theories`, which investigate recalls;
  - fix `wrong` or `needed_edits` goes to `fragile_areas` (per changed file) plus a
    **pending** `conventions` candidate;
  - every verdict updates the run's `bugs` record and `("global", "run_stats")`.
- **False alarms are fingerprinted.** A record stores hashes of the code lines it was
  about: the finding's evidence `path:line` ±2 lines, whole files otherwise. Triage may
  close a new signal as a known false alarm only by citing a recalled record whose
  lines are unchanged at this commit. When the lines changed, the record is shown as a
  hint ("never a reason to close"), and a close that cites it is overridden to
  `triaged` in code.
- **Conventions start pending.** They reach prompts only after
  `bug-hunter memory approve <id> [--text "…"]`. `memory list` always lists the
  pending ones at the end.
- **GitHub label reader:** reads `bh-diagnosis:*` and `bh-fix:*` labels plus the
  latest comment on bug-hunter PRs and issues. It is built and tested with fakes, and
  switched off (`memory.github_feedback: false`). ally-platform is public, so it trusts
  only labels applied by, and comments written by, members of `memory.github_org`
  (HelloAllyTech) or logins in `memory.github_allow`. Everything else is ignored and
  logged, and kept in `GitHubLabelFeedback.ignored`. Membership is asked once per
  login; an unknown answer counts as not a member.
- **Evals never touch live memory.** Namespaces are `(scope, app, kind)`; evals use an
  `eval-…` scope. **Holdout cases never enter memory:** `GraphAgent` gives a holdout
  case no memory, and the memory check refuses holdout cases and the live scope.
- **No new prompt versions.** Recall reaches the models through the existing
  `memory_recall` context slot, inside node budgets: triage, investigate (newly added)
  and fix. Each line carries its own instruction (the exact texts are in
  `memory/recall.py`). Triage's structured answer gained `memory_match`.

## Code map

| Path | What |
|---|---|
| `src/bug_hunter/memory/records.py` | Typed records per namespace; ids `bug-`/`fa-`/`wt-`/`cv-`/`fr-`/`rs-` |
| `src/bug_hunter/memory/store.py` | `Memory` over a LangGraph `BaseStore`; scrub on every write; ranking in code (signature, file overlap, word overlap, plus the semantic score when pgvector is used); `open_memory` (PostgresStore, `memory.semantic: auto\|on\|off`), `in_memory` |
| `src/bug_hunter/memory/fingerprint.py` | Evidence line refs → hashes; `unchanged()` (no fingerprints or a missing file is never unchanged) |
| `src/bug_hunter/memory/verdicts.py` | `Verdict` (validated), `InMemoryVerdicts`, `PostgresVerdicts` |
| `src/bug_hunter/memory/feedback.py` | `apply_verdict`, `run_feedback`, `approve_convention`, `bug_record_for`, `GitHubLabelFeedback` |
| `src/bug_hunter/memory/recall.py` | `triage_recall` (blocking/hint false alarms, past bugs), `investigate_recall`, `fix_recall` (approved conventions + past fixes), `fragile_hits`, `raised` |
| `graph/nodes/learn.py` | After `report`: writes the run's `bugs` record (no model) |
| `graph/nodes/{triage,investigate,fix,risk}.py` | Recall + closing checks; `state.recalled` lists the ids shown; risk gate raises risk one level for fragile files (never into human_only) |
| `cli.py` | `verdict`, `feedback`, `memory list\|show\|approve\|delete`, `run --no-memory`, `eval memory-check` |
| `evals/memory_check.py`, `evals/golden/memory-check.yaml` | Two-pass mechanics check with simulated verdicts |
| `.github/workflows/bug-hunter-evals.yml` | `what: memory-check` (one job, real PostgresStore with pgvector in the eval scope) |

## How to test

- `make test`: `tests/test_memory.py` (scrubber on every kind, scopes, semantic mode on
  a fake index, fingerprints, verdict mapping, the triage closing rules, duplicate
  close, learn + fragile risk, CLI list/approve/delete) and `tests/test_memory_check.py`
  (two passes recall the verdict; holdout and live scope refused; GraphAgent gives a
  holdout case no memory).
- `make db-up` then `poetry run pytest -m docker tests/integration/test_memory_postgres.py`:
  the real PostgresStore in signature mode, plus the verdicts table.

## For chunk 08 (signals): ally-platform is public

- **Who may raise an issue signal:** an issue signal may only come from an issue opened
  by a HelloAllyTech org member, or labelled `bug` by one (the label event's actor, not
  just the label's presence). Issues from anyone else are ignored and logged, the same
  way the feedback reader treats them.
- **How issue text enters prompts:** issue text, and comments if they are ever used,
  always enters prompts as quoted, scrubbed data, never as instructions. It is inside a
  clearly delimited block, and the prompt says the block is a user report to analyse,
  not instructions to follow. This applies to the triage, investigate and review inputs
  alike.

## Mechanics check results (run 43555980695, 2026-11-14, $1.60, 75 min)

Real PostgresStore with pgvector (semantic search on), eval scope
`eval-memcheck-20261114-042218`. Report:
`bug-hunter/evals/results/20261114-042220-memory-check.md`.

| Case | Pass 1 | Verdict applied | Pass 2 recalled | Pass 2 | Expected |
|---|---|---|---|---|---|
| ally-ai-6e81b510 (sweep) | no bug, no finding: no false alarm this time | not_a_bug, but nothing to record (no finding) | – | no bug | The false-alarm close: **not exercised**, because pass 1 raised no false alarm |
| ally-be-89d8e055 | suggested fix (fullwidth theory), oracle fail | wrong / wrong: wt-, fr-, pending cv- | bug-2b49b0125a (its own pass 1 record) | **closed as duplicate** of it, $0.002 | investigate recalls wt-b706… and avoids the fullwidth theory |
| ally-web-eebbfd01 | escalated, finding in ui-shared | wrong / none: wt- | its own bug record plus 9299e9aa's (unrelated) | **closed as duplicate** | investigate recalls wt-5075… |
| ally-web-9299e9aa | suggested fix (20), oracle fail | correct / needed_edits: fr-, cv- approved | its own bug record plus eebbfd01's (unrelated) | **closed as duplicate** | fix recalls the approved convention (10) |

What it shows:

1. **The duplicate close fired, against records it should never close on.** Pass 2
   closed every issue case as a duplicate of its own pass 1 record, although the
   human verdict on those records said the diagnosis was wrong (89d8e055, eebbfd01) or
   the fix needed edits (9299e9aa). Triage closed before investigate and fix, so the
   wrong theories and the approved convention were never reached. The code check
   ("cite a recalled bug record") held, but it is too weak.
2. **Semantic recall is noisy.** With pgvector on, every record's similarity score
   cleared the 0.15 threshold. An unrelated bug (the WhatsApp preview vs the helpline
   router crash) was recalled into triage, in pass 1 already (9299e9aa recalled
   eebbfd01's record).
3. **The hint-only rule** had no case to fire on. It is covered by the offline tests
   (`test_a_false_alarm_on_changed_lines_is_a_hint_not_a_block`) only.
4. **The mechanics themselves work** end to end: learn wrote the bug records, the
   verdicts mapped to the right namespaces, and approve moved a convention to approved.
   Fingerprints were taken at the case commit, holdout was never involved, and nothing
   touched live memory.

### First follow-up: built 2026-11-14, re-checked (run 43622436211)

The user's rule for a matching past bug record (enforced in triage code, one test per
row in `tests/test_memory_rows.py`):

1. diagnosis correct, fix worked or no fix verdict yet, lines unchanged: close as
   duplicate;
2. diagnosis correct, lines changed: investigate, with "possible regression of bug-…"
   (`state.regression_of`; investigate recalls it). Changed lines take precedence over
   the fix verdict;
3. diagnosis correct, fix wrong or needed_edits: skip investigate, reuse the stored
   finding (`state.reused_from`), then reproduce and fix with the past fix, its verdict
   reason and the approved conventions;
4. no verdict: "UNCONFIRMED PAST BUG", a hint only, never closes;
5. diagnosis wrong or not_a_bug: not shown as a bug; the wrong-theory or false-alarm
   record carries the lesson.

Recall: similarity only ranks. A record is recalled only with a matching signature, a
shared file, or a word overlap of at least `memory.min_word_overlap` (0.1; in the
2026-11-14 check, related pairs scored 0.19–0.64 and unrelated ones at most 0.05).
Capped at 5 records per query. Bug records now store the finding and the verdict reason.

### Re-check results (run 43622436211, 2026-11-14, $3.17, 94 min)

Report: `bug-hunter/evals/results/20261114-174523-memory-check.md`.

| Case | Expected row | Row applied | Pass 2 recalled | Pass 1 → pass 2 (oracle) |
|---|---|---|---|---|
| ally-ai-6e81b510 (sweep) | none: pass 1 had no finding | none | – | no bug → no bug (the false-alarm close is still unexercised by a paid run) |
| ally-be-89d8e055 | 5 not shown | 5: the pass 1 bug record was not shown | wt-2e0c… (the wrong theory) | suggested fix, "invisible marks / ASCII regex" (fail) → suggested fix, **zero-width spaces** stripped before matching (fail) |
| ally-web-eebbfd01 | 5 not shown | 5 | wt-c893… | escalated, could not reproduce (finding: PageviewTracker calls useLocation outside the Router) → **closed as no bug** |
| ally-web-9299e9aa | 3 reuse | **2 possible regression** | bug-acff… (triage and investigate) | suggested fix, 20 (fail) → escalated: the repro test could not be run 3 times |

What it shows:

- **Rows 5 and the evidence rule work.** Bug records judged wrong were hidden, each
  case recalled only its own wrong theory, and no unrelated records appeared (pass 1
  had cross-recall last time).
- **89d8e055: the wrong theory changed the diagnosis to the real cause.** The pass 2
  patch strips zero-width characters before matching. It still fails the oracle,
  because the oracle also tests a new exported `normaliseTranslationTokens` (the real
  fix's shape). The case should be `oracle_shape: true`, with human review of this
  patch.
- **eebbfd01: a wrong verdict poisoned memory.** Pass 1's finding was the right one this
  time (PageviewTracker outside the Router). The simulated verdict, written for an
  earlier run's ui-shared theory, called it wrong, and pass 2 then concluded "no bug".
  So: a verdict must be judged against the run it is about (the mechanics check's
  static verdicts cannot be), and one wrong verdict can suppress a correct diagnosis.
  The dashboard in chunk 09 should show the run's finding next to the verdict form.
- **9299e9aa: a bug in `learn` (fixed).** It fingerprinted the worktree after the fix had
  been applied, so pass 2, on the same commit, saw "changed lines" and took row 2
  instead of row 3. `learn` now fingerprints the base commit (`deps.read_at_base`), with
  a test that failed before the fix. Row 2 then sent it to investigate, and the repro
  test could not be run in the sandbox three times (an infra flake, unrelated to
  memory).
- Rows 1, 2 (genuine) and 4 have offline tests only.

### The proposal it replaced

- **(a) What a duplicate may close on:** a `bugs` record may close a new signal as a
  duplicate only when a human confirmed it (`diagnosis: correct`). Records with no
  verdict are shown as "PAST BUG (unconfirmed)", a hint that cannot close. Records
  judged `wrong` or `not_a_bug` are not shown as bugs at all; their `wrong_theories`
  and `false_alarms` records carry the lesson.
- **(b) Semantic recall needs evidence:** the semantic score only ranks. A record is
  recalled only with a signature match, a shared file, or a word overlap of at least
  0.1.
- Then re-run this check (about $3; pass 2 would then reach investigate and fix).

## Open

- The paid mechanics check (4 cases, about $3) and its results.
- pgvector on the production `bughunter` database is still unconfirmed. `auto` falls
  back to signature lookup.
- The brief's "replay the golden set twice" eval was replaced, by the user's choice, with
  the mechanics check.
