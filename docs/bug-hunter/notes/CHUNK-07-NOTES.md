# Chunk 07 notes: long-term memory and feedback

Status: **built, offline tests and Postgres integration tests green; paid mechanics
check not run yet** (waiting for the user's go). The chunk closes after that check.

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

## Open

- The paid mechanics check (4 cases, about $3) and its results.
- pgvector on the production `bughunter` database is still unconfirmed. `auto` falls
  back to signature lookup.
- The brief's "replay the golden set twice" eval was replaced, by the user's choice, with
  the mechanics check.
